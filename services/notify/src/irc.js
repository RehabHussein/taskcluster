const debug = require('debug')('notify');
const irc = require('irc-upd');
const assert = require('assert');
const aws = require('aws-sdk');

const MAX_RETRIES = 5;

/** IRC bot for delivering notifications */
class IRCBot {
  /**
   * Create IRC bot
   *
   * optipns:
   * ```js
   * {
   *   server:   'irc.mozilla.org',
   *   nick:     '',
   *   userName: '',
   *   realName: '',
   *   password: '',
   *   aws:      {...},
   * }
   * ```
   */
  constructor(options) {
    assert(options, 'options is required');
    assert(options.server, 'options.server is required');
    assert(options.port, 'options.port is required');
    assert(options.nick, 'options.nick is required');
    assert(options.userName, 'options.userName is required');
    assert(options.realName, 'options.realName is required');
    assert(options.password, 'options.password is required');
    assert(options.aws, 'options.aws is required');
    assert(options.queueName, 'options.queueName is required');
    assert(options.monitor, 'options.monitor is required');
    this.monitor = options.monitor;
    this.client = new irc.Client(options.server, options.nick, {
      userName: options.userName,
      realName: options.realName,
      password: options.password,
      port: options.port,
      autoConnect: false,
      secure: true,
      debug: options.debug || false,
      showErrors: true,
    });
    this.client.on('error', rpt => {
      if (rpt.command !== 'err_nosuchnick') {
        this.monitor.reportError(new Error('irc_error'), rpt);
      }
    });
    this.client.on('unhandled', msg => {
      this.monitor.notice(msg);
    });
    this.sqs = new aws.SQS(options.aws);
    this.queueName = options.queueName;
    this.stopping = false;
    this.done = Promise.resolve(null);
  }

  async start() {
    await new Promise((resolve, reject) => {
      try {
        this.client.connect(resolve);
      } catch (err) {
        if (err.command !== 'rpl_welcome') {
          reject(err);
        }
        resolve();
      }
    });

    let queueUrl = await this.sqs.createQueue({
      QueueName: this.queueName,
    }).promise().then(req => req.QueueUrl);

    this.done = (async () => {
      debug('Connecting to: ' + queueUrl);
      while (!this.stopping) {
        debug('Waiting for message from sqs.');
        let req = await this.sqs.receiveMessage({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateReceiveCount'],
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 30,
          WaitTimeSeconds: 20,
        }).promise();
        if (!req.Messages) {
          debug('Did not receive any messages from sqs in timeout.');
          continue;
        }
        debug(`Received ${req.Messages.length} messages from sqs.`);
        let success = 0;
        for (let message of req.Messages) {
          try {
            await this.notify(JSON.parse(message.Body));
          } catch (err) {
            console.log('Failed to send IRC notification: %j, %s', err, err.stack);
            // Skip deleting if we're below MAX_RETRIES
            if (message.Attributes.ApproximateReceiveCount < MAX_RETRIES) {
              continue;
            }
          }
          // Delete message
          await this.sqs.deleteMessage({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }).promise();
          success += 1;
        }
        debug(`Deleted ${success} message from sqs.`);
      }
      debug('Stopping irc sqs loop');
    })();
  }

  async notify({channel, user, message}) {
    if (channel && !/^[#&][^ ,\u{0007}]{1,199}$/u.test(channel)) {
      debug('irc channel ' + channel + ' invalid format. Not attempting to send.');
      return;
    }
    debug(`Sending message to ${user || channel}: ${message}.`);
    if (channel) {
      // This callback does not ever have an error. If it triggers, we have succeeded
      // Time this out after 10 seconds to avoid blocking forever
      await new Promise((accept, reject) => {
        setTimeout(() => {
          debug('Timed out joining channel, may be ok. Proceeding.');
          accept();
        }, 10000);
        this.client.join(channel, accept);
      });
    }
    // Post message to user or channel (which ever is given)
    this.client.say(user || channel, message);
  }

  async terminate() {
    this.stopping = true;
    await this.done;
    await new Promise((resolve, reject) => {
      try {
        this.client.disconnect(resolve);
      } catch (err) {
        reject(err);
      }
    });
  }

}

module.exports = IRCBot;
