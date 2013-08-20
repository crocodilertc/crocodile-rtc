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
	var strData = "Test Data";
	
	QUnit.module("DataAPI");
	
	QUnit.asyncTest("Test send fail", 1, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 10000);
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send("invalid@invalid", strData, {
				onSuccess: function () {
					assert.ok(false, 'TransferProgress.onSuccess event should not fire');
				},
				onFailure: function () {
					assert.ok(true, 'TransferProgress.onFailure event fired');
					clearTimeout(hungTimerId);
					croc1.stop();
					croc2.stop();
				}
			});
		});
		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("Test default send", 4, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 10000);
		
		croc2.data.onData = function(event) {
			assert.ok(true, 'onData event fired');

			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Expected address');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');

			clearTimeout(hungTimerId);
			croc1.stop();
			croc2.stop();
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData);
		});
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Invalid Configuration: wrong type set", 1, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		setTimeout(function() {
			croc1.stop();
			croc2.stop();
		}, 2000);
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			assert.throws(function() {
				croc1.data.send(config2.address, strData, {
					type: 'invalid'
				});
			}, CrocSDK.Exceptions.ValueError, "Throws if wrong type is set.");
		});
		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("Test a page mode send with config set", 4, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 10000);
		
		croc2.data.onData = function (event) {
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Expected address');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData, {
				type: 'page',
				contentType: "text/plain",
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					clearTimeout(hungTimerId);
					croc1.stop();
					croc2.stop();
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				}
			});
		});
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Test XHTML send", 3, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
		}, 10000);
		// Have to specify NS to satisfy equality assertion
		var strData = '<strong xmlns="http://www.w3.org/1999/xhtml">XMPP test message</strong> ' + new Date();

		croc2.data.onXHTMLReceived = function(event) {
			assert.ok(true, 'onXHTMLReceived event fired');

			// Check event object properties
			var s = new XMLSerializer();
			var receivedString = s.serializeToString(event.body);
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(receivedString, strData, 'Expected string data');

			clearTimeout(hungTimerId);
			croc1.stop();
			croc2.stop();
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.sendXHTML(config2.address, strData);
		});
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Test rejecting message", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			hungTimerId = null;
		}, 10000);
		// Have to specify NS to satisfy equality assertion
		var strData = '<strong xmlns="http://www.w3.org/1999/xhtml">XMPP test message</strong> ' + new Date();
		var testCustomHeaders = new CrocSDK.CustomHeaders({
				"X-Foo": 'bar',
				"X-Test-.!%*+`'~0123456789": 'Yee-ha!'
		});

		croc2.data.onDataSession = function(event) {
			assert.ok(true, 'onDataSession event fired');
			// Check session properties
			var session = event.session;
			assert.strictEqual(session.address, config1.address, 
					'Incoming session address correct');
			assert.strictEqual(session.displayName, config1.displayName,
					'Incoming session displayName correct');
			assert.deepEqual(session.customHeaders, testCustomHeaders, 
					'Incoming session customHeaders correct');
			session.close();
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData, {
				type: 'page',
				customHeaders: testCustomHeaders,
				onSuccess: function () {
					assert.ok(false, 'Message accepted');
				},
				onFailure: function () {
					assert.ok(true, 'Message rejected');

					if (hungTimerId) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
					croc1.stop();
					croc2.stop();
				}
			});
		});
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Test composing notifications", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.stop();
			croc2.stop();
			hungTimerId = null;
		}, 30000);
		// Have to specify NS to satisfy equality assertion
		var strData = 'blah blah blah' + new Date();
		var croc2Session = null;
		var numNotifications = 0;
		var idleTimerId = null;

		croc2.data.onDataSession = function(event) {
			croc2Session = event.session;
			croc2Session.accept();
			croc2Session.onData = function () {
				croc2Session.setComposingState('composing');
			};
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'page'
			});

			session.onComposingStateChange = function (event) {
				numNotifications++;
				if (numNotifications === 1) {
					assert.strictEqual(event.state, 'composing', 'croc2 is composing');
					idleTimerId = setTimeout(function () {
						assert.ok(false, 'No idle notification');
					}, 16000);
				} else if (numNotifications === 2) {
					clearTimeout(idleTimerId);
					assert.strictEqual(event.state, 'idle', 'croc2 is idle (timeout)');
					croc2Session.setComposingState('composing');
				} else if (numNotifications === 3) {
					assert.strictEqual(event.state, 'composing', 'croc2 is composing');
					croc2Session.setComposingState('idle');
				} else if ( numNotifications === 4) {
					assert.strictEqual(event.state, 'idle', 'croc2 is idle (forced)');
					session.close();
				} else {
					assert.ok(false, 'Unexpected number of notifications');
				}
			};

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.stop();
				croc2.stop();
			};
		});
		// QUnit will restart once the second croc object has disconnected
	});

	// For data.onDataSession, data.close and msrp data.send; tests are run on test module 'MSRP Data Sessions'
}(jQuery));