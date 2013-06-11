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
	
	QUnit.module("Data API");
	
	QUnit.asyncTest("Test send fail", 1, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
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
					croc1.disconnect();
					croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);
		
		croc2.data.onData = function(event) {
			assert.ok(true, 'onData event fired');

			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Expected address');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');

			clearTimeout(hungTimerId);
			croc1.disconnect();
			croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
					croc1.disconnect();
					croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
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
			croc1.disconnect();
			croc2.disconnect();
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.sendXHTML(config2.address, strData);
		});
		// QUnit will restart once the second croc object has disconnected
	});

	// For data.onDataSession, data.close and msrp data.send; tests are run on test module 'MSRP Data Sessions'
}(jQuery));