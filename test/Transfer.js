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
		displayName: 'Unit Tester #1',
		features: ['audio', 'transfer']
	};
	var config1NoRegister = {
		apiKey: testApiKey,
		address: testUsers[0].address,
		password: testUsers[0].password,
		displayName: 'Unit Tester #1',
		features: ['audio', 'transfer'],
		register: false
	};
	var config2 = {
		apiKey: testApiKey,
		address: testUsers[1].address,
		password: testUsers[1].password,
		displayName: 'Unit Tester #2'
	};
	var config3 = {
		apiKey: testApiKey,
		address: testUsers[2].address,
		password: testUsers[2].password,
		displayName: 'Unit Tester #3',
		onDisconnected: function (event) {
			if (event.status === 'normal') {
				QUnit.start();
			}
			// Otherwise wait for the hung test timeout
		}
	};

	QUnit.module("Transfer");

	QUnit.asyncTest("Successful blind transfer", 16, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
						// Close the old session
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'transfer target onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'transfer target onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');
				newSession.onConnect = function() {
					assert.ok(true, 'caller newSession.onConnect fired');
				};

				// Clean up the croc objects when the new session closes
				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
					if (hungTimerId !== null) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
					croc1.stop();
					croc2.stop();
					croc3.stop();
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

	QUnit.asyncTest("Remote party lacks REFER support", 6, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			hungTimerId = null;
		}, 60000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
				if (hungTimerId !== null) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
			};

			// Accept the session
			session.accept();
		};

		// Wait for callee to register before attempting to connect
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
				// Transfer shortly after connecting
				assert.throws(function () {
					session.transfer(config3.address);
				}, CrocSDK.Exceptions.UnsupportedError, 'Threw UnsupportedError');
				session.close();
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
			};
		};

		croc2.onDisconnected = function(event) {
			if (event.status === 'normal') {
				QUnit.start();
			}
			// Otherwise wait for the hung test timeout
		};
	});

	QUnit.asyncTest("Rejected transfer", 9, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			hungTimerId = null;
		}, 60000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(false, 'Transfer accepted');
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(true, 'Transfer rejected');
						session.close();
					};
				}, 5000);
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
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				event.reject();
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
				if (hungTimerId !== null) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
			};
		};

		croc2.onDisconnected = function(event) {
			if (event.status === 'normal') {
				QUnit.start();
			}
			// Otherwise wait for the hung test timeout
		};
	});

	QUnit.asyncTest("Successful transfer", 17, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
					};
					feedback.onTransferSucceeded = function() {
						assert.ok(true, 'Transfer succeeded');
						// Close the old session
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
					feedback.onTransferFailed = function() {
						assert.ok(false, 'Transfer failed');
					};
					feedback.onTransferResultUnknown = function() {
						assert.ok(false, 'Transfer result unknown');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'transfer target onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'transfer target onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');
				newSession.onConnect = function() {
					assert.ok(true, 'caller newSession.onConnect fired');
				};

				// Clean up the croc objects when the new session closes
				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
					if (hungTimerId !== null) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
					croc1.stop();
					croc2.stop();
					croc3.stop();
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

	QUnit.asyncTest("Failed transfer", 13, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
					};
					feedback.onTransferSucceeded = function() {
						assert.ok(false, 'Transfer succeeded');
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
					feedback.onTransferFailed = function() {
						assert.ok(true, 'Transfer failed');
						// Proceed with existing session a while longer
						setTimeout(function() {
							session.close();
						}, 5000);
					};
					feedback.onTransferResultUnknown = function() {
						assert.ok(false, 'Transfer result unknown');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Reject the session
			session.close();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');

				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
				if (hungTimerId !== null) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
				croc3.stop();
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

	QUnit.asyncTest("In-dialog successful blind transfer", 16, function(assert) {
		var croc1 = $.croc(config1NoRegister);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
						// Close the old session
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'transfer target onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'transfer target onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');
				newSession.onConnect = function() {
					assert.ok(true, 'caller newSession.onConnect fired');
				};

				// Clean up the croc objects when the new session closes
				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
					if (hungTimerId !== null) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
					croc1.stop();
					croc2.stop();
					croc3.stop();
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

	QUnit.asyncTest("In-dialog rejected transfer", 9, function(assert) {
		var croc1 = $.croc(config1NoRegister);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			hungTimerId = null;
		}, 60000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(false, 'Transfer accepted');
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(true, 'Transfer rejected');
						session.close();
					};
				}, 5000);
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
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				event.reject();
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
				if (hungTimerId !== null) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
			};
		};

		croc2.onDisconnected = function(event) {
			if (event.status === 'normal') {
				QUnit.start();
			}
			// Otherwise wait for the hung test timeout
		};
	});

	QUnit.asyncTest("In-dialog successful transfer", 17, function(assert) {
		var croc1 = $.croc(config1NoRegister);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
					};
					feedback.onTransferSucceeded = function() {
						assert.ok(true, 'Transfer succeeded');
						// Close the old session
						session.close();
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
					feedback.onTransferFailed = function() {
						assert.ok(false, 'Transfer failed');
					};
					feedback.onTransferResultUnknown = function() {
						assert.ok(false, 'Transfer result unknown');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'transfer target onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - closing session');
					session.close();
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'transfer target onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');
				newSession.onConnect = function() {
					assert.ok(true, 'caller newSession.onConnect fired');
				};

				// Clean up the croc objects when the new session closes
				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
					if (hungTimerId !== null) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
					croc1.stop();
					croc2.stop();
					croc3.stop();
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

	QUnit.asyncTest("In-dialog failed transfer", 13, function(assert) {
		var croc1 = $.croc(config1NoRegister);
		var croc2 = $.croc(config2);
		var croc3 = $.croc(config3);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			croc3.stop();
			hungTimerId = null;
		}, 90000);

		// Initial callee
		croc2.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'onMediaSession fired');

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'callee onConnect fired');
				// Transfer shortly after connecting
				setTimeout(function () {
					assert.ok(true, 'Timer fired - transferring session');
					var feedback = session.transfer(config3.address);
					feedback.onAccepted = function() {
						assert.ok(true, 'Transfer accepted');
					};
					feedback.onTransferSucceeded = function() {
						assert.ok(false, 'Transfer succeeded');
					};
					feedback.onRejected = function() {
						assert.ok(false, 'Transfer rejected');
					};
					feedback.onTransferFailed = function() {
						assert.ok(true, 'Transfer failed');
						// Proceed with existing session a while longer
						setTimeout(function() {
							session.close();
						}, 5000);
					};
					feedback.onTransferResultUnknown = function() {
						assert.ok(false, 'Transfer result unknown');
					};
				}, 5000);
			};
			session.onClose = function () {
				assert.ok(true, 'callee onClose event fired');
			};

			// Accept the session
			session.accept();
		};

		// Transfer target
		croc3.media.onMediaSession = function (event) {
			var session = event.session;
			assert.ok(true, 'croc3.media.onMediaSession fired');

			// Reject the session
			session.close();
		};

		// Wait for receiver to register before sending the data
		croc2.onRegistered = function () {
			var session = croc1.media.connect(config2.address);

			// Check that expected events fire
			session.onConnect = function () {
				assert.ok(true, 'caller session.onConnect fired');
			};
			session.onTransferRequest = function(event) {
				assert.ok(true, 'caller onTransferRequest fired');
				assert.strictEqual(event.address, config3.address, 'Expected refer URI');

				var newSession = event.accept();
				assert.strictEqual(newSession.address, config3.address, 'Expected session address');

				newSession.onClose = function () {
					assert.ok(true, 'caller newSession.onClose event fired');
				};
			};

			session.onClose = function () {
				assert.ok(true, 'caller session.onClose event fired');
				if (hungTimerId !== null) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
				croc3.stop();
			};
		};

		// QUnit will restart once the third croc object has disconnected
	});

}(jQuery));
