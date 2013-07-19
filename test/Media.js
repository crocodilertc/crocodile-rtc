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

	QUnit.module("Media Sessions");

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
//			croc1.disconnect();
//			croc2.disconnect();
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
//				croc1.disconnect();
//				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Forked call, two accepts", 10, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		delete croc2.onDisconnected;
		var croc3 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
			croc3.disconnect();
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
					croc1.disconnect();
					croc2.disconnect();
					croc3.disconnect();
				}, 2000);
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Simple re-INVITE", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 30000);

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Accept the session
			session.accept();

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			session.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
				// Send a re-INVITE a short while later
				setTimeout(function () {
					// Not intended to be a public method
					session._sendReinvite();
					assert.ok(true, 're-INVITE sent');
				}, 2000);
				// Close a fixed time after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 4000);
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Multiple sequential re-INVITEs", 8, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 40000);
		var session1, session2;

		croc2.media.onMediaSession = function (event) {
			session2 = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Accept the session
			session2.accept();

			// Clean up the croc objects when the session closes
			session2.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			session1 = croc1.media.connect(config2.address);

			session1.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
				// Schedule following re-INVITEs
				// Assumes the re-INVITEs are quick (no ICE)
				setTimeout(function () {
					// Not intended to be a public method
					console.log('session2 sending re-INVITE', Date.now());
					session2._sendReinvite();
					assert.ok(true, 're-INVITE 1 sent');
				}, 2000);
				setTimeout(function () {
					// Not intended to be a public method
					console.log('session2 sending re-INVITE', Date.now());
					session2._sendReinvite();
					assert.ok(true, 're-INVITE 2 sent');
				}, 4000);
				setTimeout(function () {
					// Not intended to be a public method
					console.log('session1 sending re-INVITE', Date.now());
					session1._sendReinvite();
					assert.ok(true, 're-INVITE 3 sent');
				}, 6000);
				setTimeout(function () {
					// Not intended to be a public method
					console.log('session1 sending re-INVITE', Date.now());
					session1._sendReinvite();
					assert.ok(true, 're-INVITE 4 sent');
				}, 8000);
				// Close a fixed time after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session1.close();
				}, 10000);
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Hold/Resume", 17, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 40000);
		var requestStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: true, receive: true}
		});
		var localHoldStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: false},
			video: {send: true, receive: false}
		});
		var remoteHoldStreams = new CrocSDK.StreamConfig({
			audio: {send: false, receive: true},
			video: {send: false, receive: true}
		});
		var numRenegotiations = 0;

		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');
			assert.deepEqual(session.streamConfig, requestStreams,
					'Expected callee initial streams');

			// Accept the session
			session.accept();

			session.onHold = function () {
				assert.ok(true, 'onHold fired');
				assert.deepEqual(session.streamConfig, remoteHoldStreams,
						'Expected callee hold streams');
				assert.throws(
						function () {
							session.hold();
						}, CrocSDK.Exceptions.StateError,
						'Immediate reverse-hold attempt raises exception');
			};

			session.onResume = function () {
				assert.ok(true, 'onResume fired');
				assert.deepEqual(session.streamConfig, requestStreams,
						'Expected callee resume streams');
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address, {
				streamConfig: requestStreams
			});

			session.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
				assert.deepEqual(session.streamConfig, requestStreams,
						'Expected caller initial streams');
				// Put the call on hold a short while later
				setTimeout(function () {
					session.hold();
					assert.ok(true, 'hold requested');
				}, 2000);
			};

			session.onRenegotiateComplete = function () {
				numRenegotiations++;
				switch (numRenegotiations) {
				case 1:
					assert.ok(true, 'hold successful');
					assert.deepEqual(session.streamConfig, localHoldStreams,
							'Expected caller hold streams');
					// Resume the call a short while later
					setTimeout(function () {
						session.resume();
						assert.ok(true, 'resume requested');
					}, 2000);
					break;
				case 2:
					assert.ok(true, 'resume successful');
					assert.deepEqual(session.streamConfig, requestStreams,
					'Expected caller resume streams');
					// Close the session a short while later
					setTimeout(function () {
						assert.ok(true, 'Timer fired - closing session');
						session.close();
					}, 2000);
					break;
				default:
					assert.ok(false, 'unexpected renegotiation');
					break;
				}
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Two-way Hold/Resume", 22, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 60000);
		var requestStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: true, receive: true}
		});
		var localHoldStreams = new CrocSDK.StreamConfig({
			audio: {send: true, receive: false},
			video: {send: true, receive: false}
		});
		var remoteHoldStreams = new CrocSDK.StreamConfig({
			audio: {send: false, receive: true},
			video: {send: false, receive: true}
		});
		var bothHoldStreams = new CrocSDK.StreamConfig({
			audio: {send: false, receive: false},
			video: {send: false, receive: false}
		});
		var numRenegotiations = 0;
		var session1, session2;

		croc2.media.onMediaSession = function (event) {
			session2 = event.session;
			assert.ok(true, 'onMediaSession fired');
			assert.deepEqual(session2.streamConfig, requestStreams,
					'Expected callee initial streams');

			// Accept the session
			session2.accept();

			// Clean up the croc objects when the session closes
			session2.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			session1 = croc1.media.connect(config2.address, {
				streamConfig: requestStreams
			});

			session1.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
				assert.deepEqual(session1.streamConfig, requestStreams,
						'Expected caller initial streams');
				// Put the call on hold a short while later
				setTimeout(function () {
					session1.hold();
					assert.ok(true, 'session1.hold requested');
				}, 2000);
			};

			session1.onRenegotiateComplete = function () {
				numRenegotiations++;
				switch (numRenegotiations) {
				case 1:
					assert.ok(true, 'session1.hold successful');
					assert.deepEqual(session1.streamConfig, localHoldStreams,
							'Expected caller hold streams');
					assert.deepEqual(session2.streamConfig, remoteHoldStreams,
							'Expected callee hold streams');
					// Next the other party puts the call on hold
					setTimeout(function () {
						session2.hold();
						assert.ok(true, 'session2.hold requested');
					}, 2000);
					break;
				case 2:
					assert.ok(true, 'session2.hold successful');
					assert.deepEqual(session1.streamConfig, bothHoldStreams,
							'Expected caller hold streams');
					assert.deepEqual(session2.streamConfig, bothHoldStreams,
							'Expected callee hold streams');
					// Next the other party resumes the call
					setTimeout(function () {
						session1.resume();
						assert.ok(true, 'session1.resume requested');
					}, 2000);
					break;
				case 3:
					assert.ok(true, 'session1.resume successful');
					assert.deepEqual(session1.streamConfig, remoteHoldStreams,
							'Expected caller hold streams');
					assert.deepEqual(session2.streamConfig, localHoldStreams,
							'Expected callee hold streams');
					// Next the other party resumes the call
					setTimeout(function () {
						session2.resume();
						assert.ok(true, 'session2.resume requested');
					}, 2000);
					break;
				case 4:
					assert.ok(true, 'session2.resume successful');
					assert.deepEqual(session1.streamConfig, requestStreams,
							'Expected caller hold streams');
					assert.deepEqual(session2.streamConfig, requestStreams,
							'Expected callee hold streams');
					// Close the session a short while later
					setTimeout(function () {
						assert.ok(true, 'Timer fired - closing session1');
						session1.close();
					}, 2000);
					break;
				default:
					assert.ok(false, 'unexpected renegotiation');
					break;
				}
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Media upgrade/downgrade", 30, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 60000);
		var audioOnly = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true}
		});
		var sendVideo = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: true, receive: false}
		});
		var sendrecvVideo = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: true, receive: true}
		});
		var recvVideo = new CrocSDK.StreamConfig({
			audio: {send: true, receive: true},
			video: {send: false, receive: true}
		});
		var numRenegotiations = 0;
		var session1, session2;
		var expectAccept = true;

		// User 1 requests audio call
		// User 1 adds local video
		// User 2 adds local video
		// User 1 removes local video
		// User 2 removes local video
		// User 1 attempts to add bi-directional video

		// Uses the default onRenegotiateRequest handler, so "safe" changes
		// should be allowed automatically.

		croc2.media.onMediaSession = function (event) {
			session2 = event.session;
			assert.ok(true, 'onMediaSession fired');
			assert.deepEqual(session2.streamConfig, audioOnly,
					'Expected callee initial streams');

			// Accept the session
			session2.accept();

			session2.onRenegotiateResponse = function (event) {
				assert.strictEqual(event.accepted, expectAccept, 'Expected result');
			};
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			session1 = croc1.media.connect(config2.address, {
				streamConfig: audioOnly
			});

			session1.onConnect = function () {
				assert.ok(true, 'caller onConnect fired');
				assert.deepEqual(session1.streamConfig, audioOnly,
						'Expected caller initial streams');
				// Add local video a short while later
				setTimeout(function () {
					session1.renegotiate({
						streamConfig: sendVideo
					});
					assert.ok(true, 'session1 upgrade requested');
				}, 2000);
			};

			// Clean up the croc objects when the session closes
			session1.onClose = function () {
				assert.ok(true, 'caller onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};

			session1.onRenegotiateResponse = function (event) {
				assert.strictEqual(event.accepted, expectAccept, 'Expected result');
			};

			session1.onRenegotiateComplete = function () {
				numRenegotiations++;
				switch (numRenegotiations) {
				case 1:
					assert.ok(true, 'session1 upgrade complete');
					assert.deepEqual(session1.streamConfig, sendVideo,
							'Expected caller streams');
					assert.deepEqual(session2.streamConfig, recvVideo,
							'Expected callee streams');
					// Next the other party adds their video
					setTimeout(function () {
						session2.renegotiate({
							streamConfig: sendrecvVideo
						});
						assert.ok(true, 'session2 upgrade requested');
					}, 2000);
					break;
				case 2:
					assert.ok(true, 'session2 upgrade complete');
					assert.deepEqual(session1.streamConfig, sendrecvVideo,
							'Expected caller streams');
					assert.deepEqual(session2.streamConfig, sendrecvVideo,
							'Expected callee streams');
					// Next the first party removes local video
					setTimeout(function () {
						session1.renegotiate({
							streamConfig: recvVideo
						});
						assert.ok(true, 'session1 downgrade requested');
					}, 2000);
					break;
				case 3:
					assert.ok(true, 'session1 downgrade complete');
					assert.deepEqual(session1.streamConfig, recvVideo,
							'Expected caller streams');
					assert.deepEqual(session2.streamConfig, sendVideo,
							'Expected callee streams');
					// Then the other party removes their video
					setTimeout(function () {
						session2.renegotiate({
							streamConfig: audioOnly
						});
						assert.ok(true, 'session2 downgrade requested');
					}, 2000);
					break;
				case 4:
					assert.ok(true, 'session2 downgrade complete');
					assert.deepEqual(session1.streamConfig, audioOnly,
							'Expected caller streams');
					assert.deepEqual(session2.streamConfig, audioOnly,
							'Expected callee streams');
					// Now the first party attempts to add bi-directional video
					setTimeout(function () {
						session1.renegotiate({
							streamConfig: sendrecvVideo
						});
						assert.ok(true, 'bi-directional video requested');
						expectAccept = false;
					}, 2000);
					break;
				case 5:
					assert.ok(true, 'session1 upgrade attempt complete');
					assert.deepEqual(session1.streamConfig, audioOnly,
							'Expected caller streams');
					assert.deepEqual(session2.streamConfig, audioOnly,
							'Expected callee streams');
					break;
				default:
					assert.ok(false, 'unexpected renegotiation');
					break;
				}
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Session timer", 15, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var sessionExpires = 90;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
				croc1.disconnect();
				croc2.disconnect();
			};
		};

		// QUnit will restart once the second croc object has disconnected
	});

}(jQuery));
