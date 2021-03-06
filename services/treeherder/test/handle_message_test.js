const assert = require('assert');
const helper = require('./helper');

suite('handle message', function() {
  helper.withLoader();
  helper.withHandler();

  test('invalid message - more than one matching route', async () => {
    helper.handler.fakeTasks['abc'] = {
      payload: {
        image: 'foo:latest',
      },
      extra: {
        treeherder: {
          reason: 'scheduled',
          tier: 1,
        },
      },
    };

    let err;

    try {
      await helper.handler.handleMessage({
        routes: ['foo.bar', 'foo.thing'],
        payload: {
          status: {
            taskId: 'abc',
          },
        },
      });
    } catch (e) {
      err = e;
    }

    assert(err, 'Error was not thrown');
    assert(err.message.includes('Could not determine treeherder route'));
  });

  test('invalid message - no matching route', async () => {
    helper.handler.fakeTasks['abc'] = {
      payload: {
        image: 'foo:latest',
      },
      extra: {
        treeherder: {
          reason: 'scheduled',
          tier: 1,
        },
      },
    };
    let err;

    try {
      await helper.handler.handleMessage({
        routes: ['foo1.bar', 'foo1.thing'],
        payload: {
          status: {
            taskId: 'abc',
          },
        },
      });
    } catch (e) {
      err = e;
    }

    assert(err, 'Error was not thrown');
    assert(err.message.includes('Could not determine treeherder route'));
  });

  test('invalid message - missing treeherder configuration', async () => {
    helper.handler.fakeTasks['abc'] = {
      payload: {
        image: 'foo:latest',
      },
    };

    await helper.handler.handleMessage({
      routes: ['foo.v2.bar.123'],
      payload: {
        status: {
          taskId: 'abc',
        },
      },
    });

    assert.deepEqual(helper.handler.taskCalls, ['abc'], 'Task was retrieved by the queue');
    assert.equal(helper.monitorManager.messages[0].Fields.key, 'handle-message');
    assert.equal(helper.monitorManager.messages[1].Fields.key, 'bar.handle-message');
    assert.equal(helper.monitorManager.messages[2].Fields.key, 'validateTask.no-config');
  });

  test('invalid message - invalid treeherder config', async () => {
    helper.handler.fakeTasks['abc'] = {
      payload: {
        image: 'foo:latest',
      },
      extra: {
        treeherder: {
          reason: 'scheduled',
          tier: 1,
        },
      },
    };

    await helper.handler.handleMessage({
      routes: ['foo.v2.bar.123'],
      payload: {
        status: {
          taskId: 'abc',
        },
      },
    });

    assert.deepEqual(helper.handler.taskCalls, ['abc'], 'Task was retrieved by the queue');
    assert.equal(helper.monitorManager.messages[0].Fields.key, 'handle-message');
    assert.equal(helper.monitorManager.messages[1].Fields.key, 'bar.handle-message');
    assert.equal(helper.monitorManager.messages[2].Fields.key, 'validateTask.invalid-config');
  });
});
