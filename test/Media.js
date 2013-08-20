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

	QUnit.module("MediaAPI");

	/*
	 * User 1 attempts to connect to user 2, but user 2 does not have
	 * the necessary event handler defined.
	 */
// TEST DISABLED WHILE SPECIAL 488 ROUTING MAY ATTEMPT ASTERISK CONNECTION
//	QUnit.asyncTest("Connect to user with no onMediaSession handler", 2, function(assert) {
//		var croc1 = $.croc(config1);
//		var croc2 = $.croc(config2);
//		// Give up if the test has hung for too long
//		var hungTimerId = setTimeout(function() {
//			assert.ok(false, 'Aborting hung test');
//			croc1.stop();
//			croc2.stop();
//		}, 30000);
//
//		// Wait for receiver to register before sending the data
//		croc2.sipUA.on('registered', function () {
//			var session = croc1.media.connect(config2.address);
//			
//			session.onConnecting = function () {
//				assert.ok(true, 'MediaSession.onConnecting event fired');
//			};
//
//			// Clean up the croc objects when the session closes
//			session.onClose = function () {
//				assert.ok(true, 'MediaSession.onClose event fired');
//				clearTimeout(hungTimerId);
//				croc1.stop();
//				croc2.stop();
//			};
//		});
//
//		// QUnit will restart once the second croc object has disconnected
//	});

	QUnit.asyncTest("Successful audio connection", 15, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 60000);
		var defaultStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true}
		});
		var provisionalFired = false;

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check the session properties
			assert.strictEqual(session.address, config1.address, 'Expected remote address');
			assert.strictEqual(session.displayName, config1.displayName, 'Expected remote name');
			assert.deepEqual(session.streamConfig, defaultStreams, 'Expected streams');
			assert.ok(session.customHeaders.isEmpty(), 'Expected custom headers');
			assert.deepEqual(session.capabilities, croc1.capabilities, 'Expected capabilities');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Close a fixed time after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 5000);
			};
			session.onRemoteMediaReceived = function () {
				assert.ok(true, 'callee onRemoteMediaReceived fired');
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnecting = function () {
				assert.ok(true, 'caller onConnecting fired');
			};
			session.onProvisional = function () {
				// May fire multiple times - only assert once
				if (!provisionalFired) {
					assert.ok(true, 'caller onProvisional fired');
					provisionalFired = true;
				}
			};
			session.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
			};
			session.onRemoteMediaReceived = function () {
				assert.ok(true, 'caller onRemoteMediaReceived fired');
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

	QUnit.asyncTest("Send-only audio connection", 12, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 60000);
		var callerStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: false}
		});
		var calleeStreams = new CrocSDK.StreamConfig({
			audio: {send: false, receive: true}
		});
		var provisionalFired = false;

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check the session properties
			assert.strictEqual(session.address, config1.address, 'Expected remote address');
			assert.strictEqual(session.displayName, config1.displayName, 'Expected remote name');
			assert.deepEqual(session.streamConfig, calleeStreams, 'Expected streams');
			assert.ok(session.customHeaders.isEmpty(), 'Expected custom headers');
			assert.deepEqual(session.capabilities, croc1.capabilities, 'Expected capabilities');

			// Accept the session, then close after a fixed time
			session.accept();
			setTimeout(function () {
				assert.ok(true, 'Timer fired - closing session');
				session.close();
			}, 15000);
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address, {
				streamConfig: callerStreams
			});

			// Check that expected events fire
			session.onConnecting = function () {
				assert.ok(true, 'onConnecting fired');
			};
			session.onProvisional = function () {
				// May fire multiple times - only assert once
				if (!provisionalFired) {
					assert.ok(true, 'onProvisional fired');
					provisionalFired = true;
				}
			};
			session.onConnect = function () {
				assert.ok(true, 'onConnect fired');
				assert.deepEqual(session.streamConfig, callerStreams, 'Expected accept streams');
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'MediaSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Receive-only audio connection", 13, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 60000);
		var callerStreams = new CrocSDK.StreamConfig({
			audio: {send: false, receive: true}
		});
		var calleeStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: false}
		});
		var provisionalFired = false;

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check the session properties
			assert.strictEqual(session.address, config1.address, 'Expected remote address');
			assert.strictEqual(session.displayName, config1.displayName, 'Expected remote name');
			assert.deepEqual(session.streamConfig, calleeStreams, 'Expected streams');
			assert.ok(session.customHeaders.isEmpty(), 'Expected custom headers');
			assert.deepEqual(session.capabilities, croc1.capabilities, 'Expected capabilities');

			// Accept the session, then close after a fixed time
			session.accept();
			setTimeout(function () {
				assert.ok(true, 'Timer fired - closing session');
				session.close();
			}, 15000);
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address, {
				streamConfig: callerStreams
			});

			// Check that expected events fire
			session.onConnecting = function () {
				assert.ok(true, 'onConnecting fired');
			};
			session.onProvisional = function () {
				// May fire multiple times - only assert once
				if (!provisionalFired) {
					assert.ok(true, 'onProvisional fired');
					provisionalFired = true;
				}
			};
			session.onConnect = function () {
				assert.ok(true, 'onConnect fired');
				assert.deepEqual(session.streamConfig, callerStreams, 'Expected accept streams');
			};
			session.onRemoteMediaReceived = function () {
				assert.ok(true, 'onRemoteMediaReceived fired');
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'MediaSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Reject video stream in accept", 13, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 60000);
		var requestStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: true, receive: true}
		});
		var acceptStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true}
		});
		var provisionalFired = false;

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check the session properties
			assert.strictEqual(session.address, config1.address, 'Expected remote address');
			assert.strictEqual(session.displayName, config1.displayName, 'Expected remote name');
			assert.deepEqual(session.streamConfig, requestStreams, 'Expected request streams');
			assert.ok(session.customHeaders.isEmpty(), 'Expected custom headers');
			assert.deepEqual(session.capabilities, croc1.capabilities, 'Expected capabilities');

			// Accept the session, then close after a fixed time
			session.accept(acceptStreams);
			setTimeout(function () {
				assert.ok(true, 'Timer fired - closing session');
				session.close();
			}, 15000);
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address, {
				streamConfig: requestStreams
			});

			// Check that expected events fire
			session.onConnecting = function () {
				assert.ok(true, 'onConnecting fired');
			};
			session.onProvisional = function () {
				// May fire multiple times - only assert once
				if (!provisionalFired) {
					assert.ok(true, 'onProvisional fired');
					provisionalFired = true;
				}
			};
			session.onConnect = function () {
				assert.ok(true, 'onConnect fired');
				assert.deepEqual(session.streamConfig, acceptStreams, 'Expected accept streams');
			};
			session.onRemoteMediaReceived = function () {
				assert.ok(true, 'onRemoteMediaReceived fired');
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'MediaSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.stop();
				croc2.stop();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Forked call, two accepts", 10, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		delete croc2.onDisconnected;
		// Must remove UUID from local storage for fork tests
		localStorage.clear();
		var croc3 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
		}, 60000);
		var defaultStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true}
		});
		var provisionalFired = false;
		var forkSessions = [];
		var callerSession;
		var closeRequested = false;
		var closeTimerId = null;
		var earlyOnCloseFired = false;
		var lateOnCloseFired = false;

		croc2.media.onMediaSession = croc3.media.onMediaSession = function (event) {
			var session = event.session;
			forkSessions.push(session);
			var fork = forkSessions.length;
			assert.ok(true, 'onMediaSession fired: fork ' + fork);

			// Check that expected events fire
			session.onConnect = function () {
				if (!closeTimerId) {
					closeTimerId = setTimeout(function () {
						assert.ok(true, 'Timer fired - closing session');
						console.log('Timer fired - closing session');
						callerSession.close();
						closeRequested = true;
					}, 5000);
				}
			};
			session.onClose = function () {
				fork = forkSessions.indexOf(this) + 1;
				if (closeRequested) {
					if (lateOnCloseFired) {
						// Two late closes - fail
						assert.ok(false, 'late onClose event fired: fork ' + fork);
					} else {
						assert.ok(true, 'late onClose event fired: fork ' + fork);
						lateOnCloseFired = true;
					}
				} else {
					if (earlyOnCloseFired) {
						// Two early closes - fail
						assert.ok(false, 'early onClose event fired: fork ' + fork);
					} else {
						assert.ok(true, 'early onClose event fired: fork ' + fork);
						earlyOnCloseFired = true;
					}
				}
			};

			if (fork > 1) {
				forkSessions.forEach(function (session) {
					session.accept();
				});
			}
		};

		// Wait for receiver to register before sending the data
		croc3.onRegistered = function () {
			var session = croc1.media.connect(config2.address, {
				streamConfig: defaultStreams
			});
			callerSession = session;

			// Check that expected events fire
			session.onConnecting = function () {
				assert.ok(true, 'caller onConnecting fired');
			};
			session.onProvisional = function () {
				// May fire multiple times - only assert once
				if (!provisionalFired) {
					assert.ok(true, 'caller onProvisional fired');
					provisionalFired = true;
				}
			};
			session.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
			};
			session.onRemoteMediaReceived = function () {
				assert.ok(true, 'caller onRemoteMediaReceived fired');
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'caller onClose event fired');
				clearTimeout(hungTimerId);
				// Wait a couple of seconds before calling disconnect to avoid
				// confusing the source of the BYE requests.
				setTimeout(function () {
					croc1.stop();
					croc2.stop();
					croc3.stop();
				}, 2000);
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

}(jQuery));
