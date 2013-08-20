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

	QUnit.module("Renegotiation");

	QUnit.asyncTest("Simple re-INVITE", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
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
				croc1.stop();
				croc2.stop();
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
			croc1.stop();
			croc2.stop();
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
				croc1.stop();
				croc2.stop();
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
			croc1.stop();
			croc2.stop();
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
				croc1.stop();
				croc2.stop();
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
			croc1.stop();
			croc2.stop();
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
				croc1.stop();
				croc2.stop();
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
			croc1.stop();
			croc2.stop();
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
				croc1.stop();
				croc2.stop();
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

}(jQuery));
