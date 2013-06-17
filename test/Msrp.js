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
	var config3 = {
		apiKey: testApiKey,
		address: testUsers[2].address,
		password: testUsers[2].password,
		displayName: 'Unit Tester #3'
	};
	var strData = 'Test data';
	var strData2 = "second expected string of data";
	var strData3 = "third expected string of data";

	QUnit.module("MSRP");
	
	QUnit.asyncTest("Send with no MSRP relays", 1, function(assert) {
		var config = {
			apiKey: testApiKey,
			address: testUsers[0].address,
			password: testUsers[0].password,
			displayName: 'Unit Tester #1',
			msrpManagerUrl: ''
		};
		var croc1 = $.croc(config);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		setTimeout(function() {
			croc1.disconnect();
			croc2.disconnect();
		}, 5000);

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			assert.throws(function() {
				croc1.data.send(config2.address, strData, {
					type: 'msrp'
				});
			}, CrocSDK.Exceptions.StateError, "Throws if msrp relays aren't defined.");
		});

		// QUnit will restart once the second croc object has disconnected
	});

	/*
	 * User 1 is the sender, user 2 is the would-be receiver, but does not have
	 * the necessary event handlers defined.
	 */
// TEST DISABLED WHILE SPECIAL 488 ROUTING MAY ATTEMPT ASTERISK CONNECTION
//	QUnit.asyncTest("Send to user with no onDataSession handler", 2, function(assert) {
//		var croc1 = $.croc(config1);
//		var croc2 = $.croc(config2);
//		// Give up if the test has hung for too long
//		var hungTimerId = setTimeout(function() {
//			assert.ok(false, 'Aborting hung test');
//			croc1.disconnect();
//			croc2.disconnect();
//		}, 10000);
//
//		// Wait for receiver to register before sending the data
//		croc2.sipUA.on('registered', function () {
//			var session = croc1.data.send(config2.address, strData, {
//				type: 'msrp',
//				onSuccess: function () {
//					assert.ok(false, 'TransferProgress.onSuccess event should not fire');
//				},
//				onFailure: function () {
//					assert.ok(true, 'TransferProgress.onFailure event fired');
//				},
//				onProgress: function () {
//					assert.ok(false, 'TransferProgress.onProgress event should not fire');
//				}
//			});
//			
//			// Clean up the croc objects when the session closes
//			session.onClose = function () {
//				assert.ok(true, 'DataSession.onClose event fired');
//				clearTimeout(hungTimerId);
//				croc1.disconnect();
//				croc2.disconnect();
//			};
//		});
//
//		// QUnit will restart once the second croc object has disconnected
//	});

	/*
	 * User 1 sends a short string to User 2.
	 * Check that the expected event handlers fire at the appropriate times,
	 * and that various object properties are set to the expected values.
	 */
	QUnit.asyncTest("Send string data", 28, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);

		// Can't use underscore in header names, as JsSIP converts to dash
		var testCustomHeaders = {
				"X-Foo": 'bar',
				"X-Test-.!%*+`'~0123456789": 'Yee-ha!'
		};

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// Check event object properties
			assert.ok(event.session instanceof CrocSDK.IncomingMsrpSession,
					'Got DataSession object');
			assert.strictEqual(event.fileTransfer, null, 'No FileTransferInfo');
			
			// Check incoming session properties
			assert.strictEqual(event.session.address, config1.address, 
					'Incoming session address correct');
			assert.strictEqual(event.session.displayName, config1.displayName,
					'Incoming session displayName correct');
			assert.deepEqual(event.session.customHeaders, testCustomHeaders, 
					'Incoming session customHeaders correct');
			var caps = event.session.capabilities;
			assert.strictEqual(caps['sip.data'], true, 
					'Incoming session data capability correct');
			assert.strictEqual(caps['sip.text'], true, 
					'Incoming session text capability correct');

			// Check immediate accept behaviour
			assert.strictEqual(event.session.getState(), 'pending', 'Session state = pending');
			event.session.accept();
			assert.strictEqual(event.session.getState(), 'pending', 'Session state still pending for immediate accepts');
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				customHeaders: testCustomHeaders,
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					
					// Successful send - close the session
					this.session.close();
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function (event) {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					
					// Check event object properties
					assert.strictEqual(event.bytesComplete, strData.length, 'Expected bytesComplete');
					assert.strictEqual(event.percentComplete, 100, 'Expected percentComplete');

					// Check outgoing session properties 2
					assert.ok(this.session instanceof CrocSDK.OutgoingMsrpSession,
							'Got DataSession object');
					var caps = this.session.capabilities;
					assert.strictEqual(caps['sip.data'], true,
							'Outgoing session data capability correct');
					assert.strictEqual(caps['sip.text'], true,
							'Outgoing session text capability correct');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
			
			// Check outgoing session properties
			assert.ok(session instanceof CrocSDK.OutgoingMsrpSession,
					'Got DataSession object');
			assert.strictEqual(session.address, config2.address,
					'Outgoing session address correct');
			assert.strictEqual(session.displayName,
					null, 'Outgoing session displayName not cached');
			assert.deepEqual(session.customHeaders, testCustomHeaders,
					'Outgoing session customHeaders correct');
			assert.strictEqual(session.capabilities, null,
					'Outgoing session capabilities not cached');

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		});

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Send string data, delayed acceptance", 14, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// Check incoming session properties
			assert.deepEqual(event.session.customHeaders, {}, 
					'Incoming session customHeaders correct');
			assert.deepEqual(event.session.capabilities, croc1.capabilities, 
					'Incoming session data capability correct');

			// Check delayed accept behaviour
			assert.strictEqual(event.session.getState(), 'pending', 'Session state = pending');
			setTimeout(function () {
				event.session.accept();
				assert.strictEqual(event.session.getState(), 'established', 
						'Session state->established immediately for delayed accepts');
			}, 1000);
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					
					// Successful send - close the session
					this.session.close();
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					
					// Check outgoing session properties 2
					assert.deepEqual(this.session.capabilities, croc2.capabilities, 
							'Outgoing session data capability correct');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
			
			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		});

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Send binary data (single chunk)", 10, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var buffer = new ArrayBuffer(256);
		var uint8view = new Uint8Array(buffer);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);

		for (var i = 0; i < uint8view.length; i++) {
			uint8view[i] = i;
		}

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// Add session-level onData handler
			event.session.onData = function (event) {
				assert.ok(true, 'Session-level onData fired');
				
				// Check event object properties
				assert.strictEqual(event.address, config1.address, 'Event address correct');
				assert.strictEqual(event.contentType, 'application/octet-stream', 'Expected MIME type');
				assert.deepEqual(new Uint8Array(event.data), uint8view, 'Expected binary data');
			};

			event.session.accept();
		};

		// Top-level onData should not fire when session catches it
		croc2.data.onData = function () {
			assert.ok(false, 'Top-level onData fired');
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, buffer, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					
					// Successful send - close the session
					this.session.close();
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					
					// Check outgoing session properties 2
					assert.deepEqual(this.session.capabilities, croc2.capabilities, 
							'Outgoing session data capability correct');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
			
			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		});

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Send binary data (multiple chunks)", 12, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var buffer = new ArrayBuffer(3072);
		var uint16view = new Uint16Array(buffer);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);

		for (var i = 0; i < uint16view.length; i++) {
			uint16view[i] = i;
		}
		
		var blob = new Blob([uint16view]);
		var reader = new FileReader();
		
		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// Add session-level onData handler
			event.session.onData = function (event) {
				assert.ok(true, 'Session-level onData fired');
				
				// Check event object properties
				assert.strictEqual(event.address, config1.address, 'Event address correct');
				assert.strictEqual(event.contentType, 'application/octet-stream', 'Expected MIME type');
				
				reader.readAsArrayBuffer(event.data);
				
				// setup file reader event handlers
				reader.onload = function(evt) {
					assert.ok(true, 'FileReader.onload fired');
					assert.deepEqual(new Uint16Array(evt.target.result), uint16view, "Expected binary data");
				};
				reader.onerror = function() {
					assert.ok(false, "FileReader.onerror event should not fire");
				};
			};

			event.session.accept();
		};		
		
		// Top-level onData should not fire when session catches it
		croc2.data.onData = function () {
			assert.ok(false, 'Top-level onData fired');
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, blob, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					
					// Successful send - close the session
					this.session.close();
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
			
			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		});
		
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Bi-directional data", 16, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc2Session = null;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);
		
		// Setup event handlers for croc2 (receiver - sender)
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'croc2 onDataSession fired');

			// Check immediate accept behaviour
			event.session.accept();
			
			croc2Session = event.session;
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'croc2 onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};

		croc1.data.onData = function (event) {
			assert.ok(true, 'croc1 onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config2.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData2, 'Expected string data');
		};
		
		// Wait for first receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					
					croc2Session.send(strData2, {
						type: 'msrp',
						onSuccess: function () {
							assert.ok(true, 'TransferProgress.onSuccess event fired');
							
							// Successful send - close the session
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'TransferProgress.onProgress event fired');

							// Check session state
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
					});

					// Clean up the croc objects when the session closes
					croc2Session.onClose = function () {
						assert.ok(true, 'DataSession.onClose event fired');
						clearTimeout(hungTimerId);
						croc1.disconnect();
						croc2.disconnect();
					};					
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
		
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Multiple sends using returned session", 23, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');

			// Check immediate accept behaviour
			event.session.accept();
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			if (event.data === strData) {
				assert.strictEqual(event.data, strData, 'Expected string data');
			} else if (event.data === strData2) {
				assert.strictEqual(event.data, strData2, 'Expected string data from second send');
			} else if (event.data === strData3) {
				assert.strictEqual(event.data, strData3, 'Expected string data from third send');
			} else {
				assert.ok(false, "unexpected data arrrived, should not have fired");
			}
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					this.session.send(strData2, {
						type: 'msrp',
						onSuccess: function () {
							assert.ok(true, 'TransferProgress.onSuccess event fired');
							this.session.send(strData3, {
								type: 'msrp',
								onSuccess: function () {
									assert.ok(true, 'TransferProgress.onSuccess event fired');
									this.session.close();
								},
								onFailure: function () {
									assert.ok(false, 'TransferProgress.onFailure event should not fire');
								},
								onProgress: function () {
									assert.ok(true, 'TransferProgress.onProgress event fired');
									
									// Check session state
									assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
								}
							});
						},
						onFailure: function () {
							assert.ok(false, 'TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'TransferProgress.onProgress event fired');
							
							// Check session state
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
					});
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					
					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});

			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
		});
	});

	QUnit.asyncTest("Automatic session management - session reuse", 17, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);
		
		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// Check immediate accept behaviour
			event.session.accept();
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					var sessionreuse = croc1.data.send(config2.address, strData, {
						type: 'msrp',
						onSuccess: function () {
							assert.ok(true, 'TransferProgress.onSuccess event fired');
							assert.strictEqual(session, sessionreuse, "expected reusable session");
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'TransferProgress.onProgress event fired');
							// Check session state
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
					});
						
					// Clean up the croc objects when the session closes
					sessionreuse.onClose = function () {
						assert.ok(true, 'DataSession.onClose event fired');
						clearTimeout(hungTimerId);
						croc1.disconnect();
						croc2.disconnect();
					};
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
	});

	QUnit.asyncTest("Automatic session management - different addresses", 18, function(assert) {
		var croc1 = $.croc(config1);
		var croc3 = $.croc(config3);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc3.disconnect();
			croc2.disconnect();
		}, 10000);
		
		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');

			event.session.accept();
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
		};

		// Set up the receiver's event handlers
		croc3.data.onDataSession = function (event) {
			assert.ok(true, 'session2 onDataSession fired');

			event.session.accept();
		};

		croc3.data.onData = function (event) {
			assert.ok(true, 'session2 onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData2, 'Expected string data for session2');
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					var session2 = croc1.data.send(config3.address, strData2, {
						type: 'msrp',
						onSuccess: function () {
							assert.ok(true, 'session2 TransferProgress.onSuccess event fired');
							assert.notEqual(session, session2, "Sessions are different as expected");
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'session2 TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'session2 TransferProgress.onProgress event fired');
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
					});
					
					// Clean up the croc objects when the session closes
					session2.onClose = function () {
						assert.ok(true, 'session2 DataSession.onClose event fired');
						clearTimeout(hungTimerId);
						croc1.disconnect();
						croc3.disconnect();
						croc2.disconnect();
					};
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
	});

	QUnit.asyncTest("Automatic session management - different custom headers", 20, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);
		
		// Can't use underscore in header names, as JsSIP converts to dash
		var sessionCustomHeaders = {
				"X-Foo": 'bar'
		};
		var session2CustomHeaders = {
				"X-Test-.!%*+`'~0123456789": 'Yee-ha!'
		};
		
		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			if (event.session.customHeaders["X-Foo"] === sessionCustomHeaders["X-Foo"]) {
				assert.deepEqual(event.session.customHeaders, sessionCustomHeaders, 
						'Incoming session customHeaders correct');
			} else if (event.session.customHeaders["X-Test-.!%*+`'~0123456789"] === session2CustomHeaders["X-Test-.!%*+`'~0123456789"]) {
				assert.deepEqual(event.session.customHeaders, session2CustomHeaders, 
						'Incoming session customHeaders correct');			
			} else {
				assert.ok(false, "Unexpected result; should not have fired");
			}
			
			event.session.accept();
		};

		croc2.data.onData = function (event) {
			assert.ok(true, 'onData fired');
			
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			if (event.data === strData) {
				assert.strictEqual(event.data, strData, 'Expected string data');
			} else if (event.data === strData2) {
				assert.strictEqual(event.data, strData2, 'Expected string data');
			} else {
				assert.ok(false, "Unexpected result; should not have fired");
			}
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				customHeaders: sessionCustomHeaders,
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					var session2 = croc1.data.send(config2.address, strData2, {
						type: 'msrp',
						customHeaders: session2CustomHeaders,
						onSuccess: function () {
							assert.ok(true, 'session2 TransferProgress.onSuccess event fired');
							assert.notEqual(session, session2, "Sessions are different as expected");
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'session2 TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'session2 TransferProgress.onProgress event fired');
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
					});
					
					// Clean up the croc objects when the session closes
					session2.onClose = function () {
						assert.ok(true, 'session2 DataSession.onClose event fired');
						clearTimeout(hungTimerId);
						croc1.disconnect();
						croc2.disconnect();
					};
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
	});

	QUnit.asyncTest("Automatic session management - file transfer parameters", 26, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var buffer = new ArrayBuffer(3072);
		var uint16view = new Uint16Array(buffer);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 10000);
		
		var fileTransferParams = {
			description: "test data"
		};

		for (var i = 0; i < uint16view.length; i++) {
			uint16view[i] = i;
		}
		
		var blob = new Blob([uint16view]);
		var reader = new FileReader();
		
		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			
			// test description can be set; name, size and disposition are automatically configured
			assert.strictEqual(event.fileTransfer.description, fileTransferParams.description, "expected fileTransferInfo");
			
			// Add session-level onData handler
			event.session.onData = function (event) {
				assert.ok(true, 'Session-level onData fired');
				
				// Check event object properties
				assert.strictEqual(event.address, config1.address, 'Event address correct');
				assert.strictEqual(event.contentType, 'application/octet-stream', 'Expected MIME type');
				
				reader.readAsArrayBuffer(event.data);
				
				// setup file reader event handlers
				reader.onload = function(evt) {
					assert.ok(true, 'FileReader.onload fired');
					assert.deepEqual(new Uint16Array(evt.target.result), uint16view, "Expected binary data");
				};
				reader.onerror = function() {
					assert.ok(false, "FileReader.onerror event should not fire");
				};
			};

			event.session.accept();
		};		
		
		// Top-level onData should not fire when session catches it
		croc2.data.onData = function () {
			assert.ok(false, 'Top-level onData fired');
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, blob, {
				type: 'msrp',
				fileTransfer: fileTransferParams,
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
					var session2 = croc1.data.send(config2.address, blob, {
						type: 'msrp',
						fileTransfer: fileTransferParams,
						onSuccess: function () {
							assert.ok(true, 'session2 TransferProgress.onSuccess event fired');
							assert.notEqual(session, session2, "Sessions are different as expected");
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'TransferProgress.onFailure event should not fire');
						},
						onProgress: function () {
							assert.ok(true, 'TransferProgress.onProgress event fired');

							// Check session state
							assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
						}
						
					});
					
					// Clean up the croc objects when the session closes
					session2.onClose = function () {
						assert.ok(true, 'session2 DataSession.onClose event fired');
						clearTimeout(hungTimerId);
						croc1.disconnect();
						croc2.disconnect();
					};
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');

					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
	});
	
	QUnit.asyncTest("session.send before session is established", 2, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		setTimeout(function() {
			croc1.disconnect();
			croc2.disconnect();
		}, 4000);
		
		// Setup event handlers for croc2 (receiver - sender)
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'croc2 onDataSession fired');

			assert.throws(function() {
				event.session.send(strData);
			}, CrocSDK.Exceptions.StateError, "Throws if session tries to send before accepting.");
		};
		
		// Wait for first receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData, {
				type: 'msrp'
			});
		});
		
		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("accepting an already established session", 3, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc2Session = null;
		// Give up if the test has hung for too long
		setTimeout(function() {
			croc1.disconnect();
			croc2.disconnect();
		}, 4000);
		
		// Setup event handlers for croc2 (receiver - sender)
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'croc2 onDataSession fired');

			// Check immediate accept behaviour
			event.session.accept();
			
			croc2Session = event.session;
		};
		
		// Wait for first receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.throws(function() {
						croc2Session.accept();
					}, CrocSDK.Exceptions.StateError, "Throws if session has already been accepted.");					
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					// Check session state
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
		});
		
		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("Automatic session management - idle session cleanup", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 15000);
		
		croc1.data.idleTimeout = 5;

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');

			// Check immediate accept behaviour
			event.session.accept();
		};
		
		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				},
				onProgress: function () {
					assert.ok(true, 'TransferProgress.onProgress event fired');
					assert.strictEqual(this.session.getState(), 'established', 'Session state = established');
				}
			});
			
			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired via idle session close');
				clearTimeout(hungTimerId);
				croc1.disconnect();
				croc2.disconnect();
			};
			
		});
	});
	
	QUnit.asyncTest("Composing state", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var croc2Session = null;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.disconnect();
			croc2.disconnect();
		}, 30000);
		var numNotifications = 0;
		var idleTimerId = null;

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			croc2Session = event.session;
			croc2Session.accept();
			croc2Session.onData = function () {
				croc2Session.setComposingState('composing');
			};
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.send(config2.address, strData, {
				type: 'msrp'
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
					croc2Session.close();
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
				croc1.disconnect();
				croc2.disconnect();
			};
		});

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Send XHTML data", 10, function(assert) {
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

		// Set up the receiver's event handlers
		croc2.data.onDataSession = function (event) {
			assert.ok(true, 'onDataSession fired');
			event.session.accept();
		};

		croc2.data.onXHTMLReceived = function (event) {
			assert.ok(true, 'onXHTMLReceived fired');
			
			// Check event object properties
			var s = new XMLSerializer();
			var receivedString = s.serializeToString(event.body);
			assert.strictEqual(event.address, config1.address, 'Event address correct');
			assert.strictEqual(receivedString, strData, 'Expected string data');
		};

		// Wait for receiver to register before sending the data
		croc2.sipUA.on('registered', function () {
			var session = croc1.data.sendXHTML(config2.address, strData, {
				type: 'msrp',
				onSuccess: function () {
					assert.ok(true, 'TransferProgress.onSuccess event fired');

					// Send again using the existing session
					session.sendXHTML(strData, {
						onSuccess: function () {
							assert.ok(true, 'TransferProgress.onSuccess event fired');
							this.session.close();
						},
						onFailure: function () {
							assert.ok(false, 'TransferProgress.onFailure event should not fire');
						}
					});
				},
				onFailure: function () {
					assert.ok(false, 'TransferProgress.onFailure event should not fire');
				}
			});
			
			// Clean up the croc objects when the session closes
			session.onClose = function () {
				assert.ok(true, 'DataSession.onClose event fired');
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				croc1.disconnect();
				croc2.disconnect();
			};
		});

		// QUnit will restart once the second croc object has disconnected
	});

}(jQuery));
