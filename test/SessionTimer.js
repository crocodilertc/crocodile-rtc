(function($) {
	/*
    ======== A Handy Little QUnit Reference ========
    http://api.qunitjs.com/

    Test methods:
      module(name, {[setup][ ,teardown]})
      test(name, callback)
      expect(numberOfAssertions)
      stop(increment)
      start(decrement)
    Test assertions:
      ok(value, [message])
      equal(actual, expected, [message])
      notEqual(actual, expected, [message])
      deepEqual(actual, expected, [message])
      notDeepEqual(actual, expected, [message])
      strictEqual(actual, expected, [message])
      notStrictEqual(actual, expected, [message])
      throws(block, [expected], [message])
	 */

	var config1 = {
		apiKey: testApiKey,
		address: testUsers[0].address,
		password: testUsers[0].password,
		displayName: 'Unit Tester #1'
	};
	var config2 = {
		apiKey: testApiKey,
		address: testUsers[1].address,
		password: testUsers[1].password,
		displayName: 'Unit Tester #2',
		onDisconnected: function (event) {
			if (event.status === 'normal') {
				QUnit.start();
			}
			// Otherwise wait for the hung test timeout
		}
	};

	QUnit.module("SessionTimer");

	QUnit.asyncTest("Session timer", 15, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var sessionExpires = 90;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, sessionExpires * 4 * 1000);
		var lastRefresh = 0;
		var numUpdates = 0;

		// Hack JsSIP in croc1 to add a Session-Expires header
		croc1.sipUA.on('newRTCSession', function(event) {
			var data = event.data;
			if (data.originator === 'local') {
				data.request.setHeader('session-expires', sessionExpires);
			}
		});

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Hack into JsSIP session to verify refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'local', 'callee sent update');
				var elapsedMillis = Date.now() - lastRefresh;
				var expectedInterval = sessionExpires / 2 * 1000;
				var errorPercentage = Math.abs(elapsedMillis - expectedInterval) * 100 / expectedInterval;
				assert.ok(errorPercentage < 5, 'update sent at expected time: ' + errorPercentage);
				event.data.update.on('succeeded', function () {
					assert.ok(true, 'Update succeeded');
					lastRefresh = Date.now();
					if (++numUpdates >= 3) {
						session.close();
					}
				});
				event.data.update.on('failed', function () {
					assert.ok(false, 'Update failed; closing session');
					session.close();
				});
			});

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				lastRefresh = Date.now();
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Hack into JsSIP session to verify refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'remote', 'caller received update');
			});

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'caller onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Session timer expiry", 7, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var sessionExpires = 90;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, sessionExpires * 2 * 1000);
		var lastRefresh = 0;

		// Hack JsSIP in croc1 to add a Session-Expires header
		croc1.sipUA.on('newRTCSession', function(event) {
			var data = event.data;
			if (data.originator === 'local') {
				data.request.setHeader('session-expires', sessionExpires);
			}
		});

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Hack into JsSIP session to verify refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'local', 'callee sent update');
				event.data.update.on('succeeded', function () {
					assert.ok(false, 'Update succeeded');
				});
				event.data.update.on('failed', function () {
					assert.ok(true, 'Update failed');
				});
			});

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				lastRefresh = Date.now();
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				var elapsedMillis = Date.now() - lastRefresh;
				var expectedExpiry = (sessionExpires - Math.max(32, sessionExpires / 3)) * 1000;
				var errorPercentage = Math.abs(elapsedMillis - expectedExpiry) * 100 / expectedExpiry;
				assert.ok(errorPercentage < 5, 'bye sent at expected time: ' + errorPercentage);
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Hack into JsSIP session to reject refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'remote', 'caller received update');
				event.data.update.reject({status_code: 488});
			});
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Session timer refreshed by reINVITE", 8, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var sessionExpires = 90;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, sessionExpires * 3 * 1000);
		var lastRefresh = 0;

		// Hack JsSIP in croc1 to add a Session-Expires header
		croc1.sipUA.on('newRTCSession', function(event) {
			var data = event.data;
			if (data.originator === 'local') {
				data.request.setHeader('session-expires', sessionExpires);
			}
		});

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Hack into JsSIP session to verify refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'local', 'callee sent update');
				var elapsedMillis = Date.now() - lastRefresh;
				var expectedInterval = sessionExpires / 2 * 1000;
				var errorPercentage = Math.abs(elapsedMillis - expectedInterval) * 100 / expectedInterval;
				assert.ok(errorPercentage < 5, 'update sent at expected time: ' + errorPercentage);
				event.data.update.on('succeeded', function () {
					assert.ok(true, 'Update succeeded; closing session');
					session.close();
				});
				event.data.update.on('failed', function () {
					assert.ok(false, 'Update failed; closing session');
					session.close();
				});
			});

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				lastRefresh = Date.now();
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Hack into JsSIP session to verify refresh
			session.sipSession.on('update', function (event) {
				assert.strictEqual(event.data.originator, 'remote', 'caller received update');
			});

			session.onConnect = function () {
				setTimeout(function () {
					session._sendReinvite();
				}, (sessionExpires / 2 - 5) * 1000);
			};

			session.onRenegotiateResponse = function (event) {
				assert.ok(event.accepted, 're-INVITE successful');
				if (event.accepted) {
					lastRefresh = Date.now();
				}
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'caller onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Session timer (UPDATE not supported)", 9, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var sessionExpires = 90;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, sessionExpires * 4 * 1000);
		var lastRefresh = 0;
		var numRefreshes = 0;

		// Hack JsSIP in croc1 to add a Session-Expires header, and disable UPDATE
		croc1.sipUA.on('newRTCSession', function(event) {
			var data = event.data;
			if (data.originator === 'local') {
				data.request.setHeader('session-expires', sessionExpires);
				data.request.setHeader('allow', 'ACK,CANCEL,BYE,OPTIONS,INVITE');
			}
		});

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				lastRefresh = Date.now();
			};

			session.onRenegotiateResponse = function (event) {
				assert.ok(event.accepted, 're-INVITE successful');
				if (event.accepted) {
					lastRefresh = Date.now();
				}
			};

			session.onRenegotiateComplete = function () {
				if (++numRefreshes >= 3) {
					session.close();
				}
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			session.onRenegotiateRequest = function (event) {
				var elapsedMillis = Date.now() - lastRefresh;
				var expectedInterval = sessionExpires / 2 * 1000;
				var errorPercentage = Math.abs(elapsedMillis - expectedInterval) * 100 / expectedInterval;
				assert.ok(errorPercentage < 5, 're-INVITE sent at expected time: ' + errorPercentage);

				event.accept();
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'caller onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

}(jQuery));
