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

	QUnit.module("Croc Object");

	QUnit.test("Invalid configuration: no config", function(assert) {
		assert.throws(function() {
			$.croc();
		}, CrocSDK.Exceptions.ValueError, "Throws if no config");
	});
	
	QUnit.test("Invalid configuration: invalid config property", function(assert) {
		var config = {
				invalid: "invalid property",
				address: testUsers[0].address,
				password: testUsers[0].password,
				sipProxySet: "blade14.croc.internal",
				register: false,
				useTLS: false
		};
		assert.throws(function() {
			$.croc(config);
		}, CrocSDK.Exceptions.ValueError, "Throws if an invalid property is set in config");
	});

	QUnit.test("Invalid configuration: numeric API key", function(assert) {
		var config = {
				apiKey: 12345
		};
		assert.throws(function() {
			$.croc(config);
		}, TypeError, "Throws if wrong type");
	});
	
	QUnit.test("Invalid configuration: apiKey and sipProxySet", function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				sipProxySet: "blade14.croc.internal",
				register: false,
				useTLS: false
		};
		assert.throws(function() {
			$.croc(config);
		}, CrocSDK.Exceptions.ValueError, "Throws if apiKey and sipProxySet are both set in config");
	});
	
	QUnit.test("Invalid configuration: valid properties; no apiKey or sipProxySet", function(assert) {
		var config = {
				address: testUsers[0].address,
				password: testUsers[0].password,
				register: false,
				useTLS: false
		};
		assert.throws(function() {
			$.croc(config);
		}, CrocSDK.Exceptions.ValueError, "Throws if apiKey and sipProxySet are not set in config");
	});

	QUnit.test("Invalid configuration: apiKey and msrpRelaySet", function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				msrpRelaySet: "blade14.croc.internal",
				register: false,
				useTLS: false
		};
		assert.throws(function() {
			$.croc(config);
		}, CrocSDK.Exceptions.ValueError, "Throws if apiKey and msrpRelaySet are both set in config");
	});
	
	QUnit.asyncTest("Valid configuration with API key", 3, function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				register: false,
				onConnected: function() {
					assert.ok(true, 'onConnected fired');
					clearTimeout(hungTimerId);
					this.disconnect();
				},
				onDisconnected: function() {
					assert.ok(true, 'onDisconnected fired');
					QUnit.start();
				}
		};
		var croc = $.croc(config);
		assert.ok(croc, 'Croc object constructed');
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc.disconnect();
		}, 10000);

		// Wait for the UA to disconnect before moving on to other tests
	});
	
	QUnit.asyncTest("User defined connect and disconnect", 2, function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				register: false,
				onConnected: function() {
					croc.disconnect();
				}
		};
		var croc = $.croc(config);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc.disconnect();
		}, 10000);
		
		setTimeout(function() {
			croc.onConnected = function() {
				assert.ok(true, 'onConnected fired');
				croc.disconnect();
			};
			croc.onDisconnected = function() {
				clearTimeout(hungTimerId);
				assert.ok(true, 'onDisconnected fired');
				QUnit.start();
			};
			croc.connect();
		}, 2000);
		
		// Wait for the UA to disconnect before moving on to other tests
	});

	QUnit.asyncTest("isConnected", 4, function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				register: false,
				onConnected: function() {
					assert.ok(true, 'onConnected fired');
					var connected = croc.isConnected();
					assert.strictEqual(connected, true, "expected return value of isConnected()");
					clearTimeout(hungTimerId);
					croc.disconnect();
				},
				onDisconnected: function() {
					var connected = croc.isConnected();
					assert.strictEqual(connected, false, "expected return value of isConnected()");
					assert.ok(true, 'onDisconnected fired');
					QUnit.start();
				}
		};
		var croc = $.croc(config);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc.disconnect();
		}, 10000);
		
		// Wait for the UA to disconnect before moving on to other tests
	});
	
	QUnit.asyncTest("registration and unregistration", 5, function(assert) {
		var config = {
				apiKey: testApiKey,
				address: testUsers[0].address,
				password: testUsers[0].password,
				register: false,
				onConnected: function() {
					assert.ok(true, 'onConnected fired');
					croc.register = true;
					assert.strictEqual(croc.register, true, "expected value for property register");
					setTimeout(function(){
						croc.reregister();
					}, 1000);
				},
				onRegistered: function() {
					assert.ok(true, 'registered to network');
					croc.unregister();
				},
				onUnregistered: function() {
					assert.ok(true, 'unregistered to network');
					clearTimeout(hungTimerId);
					croc.disconnect();
				},
				onDisconnected: function() {
					assert.ok(true, 'onDisconnected fired');
					QUnit.start();
				}
		};
		var croc = $.croc(config);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc.disconnect();
		}, 10000);

		// Wait for the UA to disconnect before moving on to other tests
	});
	
}(jQuery));
