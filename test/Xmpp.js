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
		start: false
	};
	var config2 = {
		apiKey: testApiKey,
		address: testUsers[1].address,
		password: testUsers[1].password,
		displayName: 'Unit Tester #2',
		start: false
	};
	
	var NS_DISCO = 'http://jabber.org/protocol/disco#info';

	function removeExistingContacts(contacts) {
		for (var i = 0, len = contacts.length; i < len; i++) {
			var contact = contacts[i];
			console.warn('Removing unexpected contact:', contact);
			contact.remove();
		}
	}

	QUnit.module("XMPP");
	
	QUnit.asyncTest("Basic connection, initial & subsequent presence", 8, function(assert) {
		var gotContacts = false;
		var numSelfNotifies = 0;
		var availability = 'dnd';
		var status = 'Leave me alone!';
		var croc1 = $.croc(config1);
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			hungTimerId = null;
		}, 5000);
		
		croc1.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};

		croc1.presence.onSelfNotify = function (event) {
			switch (++numSelfNotifies) {
			case 1:
				assert.ok(true, 'onSelfNotify 1');
				assert.strictEqual(event.availability, 'available', 'availability 1');
				assert.strictEqual(event.status, null, 'status 1');
				croc1.presence.publishPresence({
					availability: availability,
					status: status
				});
				break;
			case 2:
				assert.ok(true, 'onSelfNotify 2');
				assert.strictEqual(event.availability, availability, 'availability 2');
				assert.strictEqual(event.status, status, 'status 2');
				if (gotContacts) {
					croc1.presence.stop();
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
				break;
			default:
				assert.ok(false, 'Unexpected self-notify');
				break;
			}
		};

		croc1.presence.onContactsReceived = function (event) {
			assert.ok(true, 'onContactsReceived event fired');
			assert.deepEqual(event.contacts, [], 'Got empty contact list');
			if (numSelfNotifies === 2) {
				croc1.presence.stop();
				clearTimeout(hungTimerId);
				hungTimerId = null;
			} else {
				gotContacts = true;
			}
		};
		// QUnit will restart once the croc object has disconnected
	});

	QUnit.asyncTest("Add, edit, remove contact", 12, function(assert) {
		var croc1 = $.croc(config1);
		var contact = null;
		var contactAddress = 'peter.dunkley@crocodilertc.net';
		var initialName = 'Peter';
		var initialGroups = ['Co-workers'];
		var updateName = 'Pete';
		var updateGroups = ['Co-workers', 'Friends'];
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			hungTimerId = null;
		}, 5000);
		
		croc1.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};

		croc1.presence.onContactsReceived = function (event) {
			assert.ok(true, 'onContactsReceived event fired');
			removeExistingContacts(event.contacts);

			croc1.presence.addContact(contactAddress, {
				watch: false,
				allowWatch: false,
				name: initialName,
				groups: initialGroups
			});
		};

		croc1.presence.onNewContact = function (event) {
			contact = event.contact;
			assert.strictEqual(contact.address, contactAddress, 'Correct address');
			assert.strictEqual(contact.name, initialName, 'Correct initial name');
			assert.deepEqual(contact.groups.sort(), initialGroups, 'Correct initial groups');
			assert.strictEqual(contact.watching, false, 'Correct watching');
			assert.strictEqual(contact.watchingApproved, false, 'Correct watching approved');
			assert.strictEqual(contact.watchingMe, false, 'Correct watching me');
			assert.strictEqual(contact.watchPending, false, 'Correct watch pending');

			// Now update the contact
			contact.update({name: updateName, groups: updateGroups});
			contact.onUpdate = function () {
				assert.strictEqual(this.address, contactAddress, 'Correct address');
				assert.strictEqual(this.name, updateName, 'Correct update name');
				assert.deepEqual(this.groups.sort(), updateGroups, 'Correct update groups');

				// Now remove the contact
				this.remove();
			};
			contact.onRemove = function () {
				assert.ok(true, 'Contact removed');
				croc1.presence.stop();
				clearTimeout(hungTimerId);
				hungTimerId = null;
			};
		};
		// QUnit will restart once the croc object has disconnected
	});
	
	QUnit.asyncTest("Two-way subscription", 30, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var watchRequestEvent = null;
		var contact1 = null;
		var contact2 = null;
		var step = 0;
		var watch = false;
		var watchBack = false;
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 15000);

		croc1.presence.start();
		croc2.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
		};
		croc2.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};

		// Step 0: Any existing roster contacts are removed
		// Step 1: User1 adds User2 as contact, and subscribes
		// Step 2: User1 receives contact, configures contact update handler
		//  CrocSDK now sends subscribe request
		// Step 3a: User1 receives contact update, showing pending subscribe
		// Step 3b: User2 receives subscribe request
		//  User2 allows subscription
		// Step 4a: User1 receives contact update, showing successful subscribe
		// Step 4b: User2 receives new contact
		//  User2 requests reverse subscription
		// Step 5: User1 receives and accepts watch request from User2
		// Step 6: User1 receives contact update, showing two-way subscribe
		//  User1 stops watching User2
		// Step 7: User1 receives contact update, showing incoming subscribe
		//  User1 revokes subscribe from User2
		// Step 8: User1 receives contact update, showing no subscriptions
		// Step 9: Cleanup

		croc1.presence.onContactsReceived = function (event) {
			// Step 0
			removeExistingContacts(event.contacts);

			setTimeout(function () {
				// Step 1: Add contact with subscribe enabled by default
				croc1.presence.addContact(config2.address, {watchApproved: false});
				step = 1;
			}, 2000);
		};

		croc2.presence.onContactsReceived = function (event) {
			// Step 0
			removeExistingContacts(event.contacts);
		};

		croc1.presence.onWatchRequest = function (event) {
			// Step 5
			assert.strictEqual(event.address, config2.address, '5: address');
			assert.strictEqual(event.status, null, '5: status');
			event.accept();
			step = 5;
		};

		croc2.presence.onWatchRequest = function (event) {
			// Step 3b
			assert.strictEqual(event.address, config1.address, '3b: address');
			assert.strictEqual(event.status, null, '3b: status');
			watchRequestEvent = event;

			if (watch) {
				event.accept();
				step = 3;
			}
		};

		croc2.presence.onNewContact = function (event) {
			// Step 4b
			contact2 = event.contact;
			assert.strictEqual(contact2.address, config1.address, '4b: address');
			assert.strictEqual(contact1.name, null, '4b: empty name');
			assert.deepEqual(contact1.groups, [], '4b: empty groups');

			contact2.onRemove = function () {
				croc1.presence.stop();
				croc2.presence.stop();
				clearTimeout(hungTimerId);
				hungTimerId = null;
			};

			if (watchBack) {
				// We're ready for the next step
				contact2.watch();
				step = 4;
			}
		};

		croc1.presence.onNewContact = function (event) {
			// Step 2
			contact1 = event.contact;
			assert.strictEqual(contact1.address, config2.address, '2: address');
			assert.strictEqual(contact1.name, null, '2: empty name');
			assert.deepEqual(contact1.groups, [], '2: empty groups');
			step = 2;

			// This should also be testing pre-approval, but that does not seem
			// to be supported by ejabberd.
			contact1.onUpdate = function () {
				if (step === 2) {
					// Step 3a
					assert.strictEqual(contact1.watching, false, '3a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '3a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '3a: watching me');
					assert.strictEqual(contact1.watchPending, true, '3a: watch pending');
					// Now accept the watch request
					if (watchRequestEvent) {
						watchRequestEvent.accept();
						step = 3;
					} else {
						watch = true;
					}
				} else if (step === 3) {
					// Step 4a
					assert.strictEqual(contact1.watching, true, '4a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '4a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '4a: watching me');
					assert.strictEqual(contact1.watchPending, false, '4a: watch pending');
					// Now contact returns the favour
					if (contact2) {
						contact2.watch();
						step = 4;
					} else {
						watchBack = true;
					}
				} else if (step === 5) {
					// Step 6
					assert.strictEqual(contact1.watching, true, '6: watching');
					assert.strictEqual(contact1.watchingApproved, false, '6: watching approved');
					assert.strictEqual(contact1.watchingMe, true, '6: watching me');
					assert.strictEqual(contact1.watchPending, false, '6: watch pending');
					// Then stop watching
					contact1.unwatch();
					step = 6;
				} else if (step === 6) {
					// Step 7
					assert.strictEqual(contact1.watching, false, '7: watching');
					assert.strictEqual(contact1.watchingApproved, false, '7: watching approved');
					assert.strictEqual(contact1.watchingMe, true, '7: watching me');
					assert.strictEqual(contact1.watchPending, false, '7: watch pending');
					// Then stop them watching me
					contact1.denyWatch();
					step = 7;
				} else if (step === 7) {
					// Step 8
					assert.strictEqual(contact1.watching, false, '8: watching');
					assert.strictEqual(contact1.watchingApproved, false, '8: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '8: watching me');
					assert.strictEqual(contact1.watchPending, false, '8: watch pending');
					// And finally clean up rosters
					contact1.remove();
					contact2.remove();
				}
			};
		};
		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("XMPP send", 4, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
		var strData = 'XMPP test message ' + new Date() + '\n';
		strData += '<>&£äâãéèЖ';
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 10000);
		
		croc1.presence.start();
		croc2.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
		};
		croc2.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};

		croc2.data.onData = function (event) {
			assert.ok(true, "onData event fired");
			// Check event object properties
			assert.strictEqual(event.address, config1.address, 'Expected address');
			assert.strictEqual(event.contentType, 'text/plain', 'Expected MIME type');
			assert.strictEqual(event.data, strData, 'Expected string data');
			
			croc1.presence.stop();
			croc2.presence.stop();
			clearTimeout(hungTimerId);
			hungTimerId = null;
		};
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				croc1.data.send(config2.address, strData, {
					type: 'xmpp'
				});
			} else {
				firstReady = true;
			}
		};

		croc1.presence.onSelfNotify = onReady;
		croc2.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("XMPP send with chat notifications", 4, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
		var state = 'idle';
		var strData = 'XMPP test message ' + new Date();
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 6000);
		
		croc1.presence.start();
		croc2.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
		};
		croc2.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};
		
		croc2.data.onDataSession = function (event) {
			event.session.accept();
			event.session.setComposingState(state);
		};
		
		croc1.data.onComposingStateChange = function (event) {
			assert.ok(true, "onComposingStateChange fired croc1");
			assert.strictEqual(event.state, 'idle', "expected state for croc1");
			
			croc1.presence.stop();
			croc2.presence.stop();
			clearTimeout(hungTimerId);
			hungTimerId = null;
		};
		
		croc2.data.onComposingStateChange = function (event) {
			assert.ok(true, "onComposingStateChange fired croc2");
			assert.strictEqual(event.state, 'idle', "expected state for croc2");
		};
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				croc1.data.setComposingState(config2.address, strData, {
					type: 'xmpp'
				}, state);
			} else {
				firstReady = true;
			}
		};

		croc1.presence.onSelfNotify = onReady;
		croc2.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("XMPP send with delivery receipts", 2, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
		var session = null;
		var strData = 'XMPP test message ' + new Date();
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 6000);
		
		croc1.presence.start();
		croc2.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
		};
		croc2.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};
		
		croc2.data.onDataSession = function (event) {
			event.session.accept();
		};
		
		croc1.data.onDataSession = function (event) {
			event.session.onSuccess = function () {
				assert.ok(true, "xmpp onSuccess fired");
				
				croc1.presence.stop();
				croc2.presence.stop();
				clearTimeout(hungTimerId);
				hungTimerId = null;
			};
		};
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				var iq = new JSJaCIQ();
				iq.setIQ(config2.address, 'get');
				iq.setQuery(NS_DISCO);
				
				var iqCallBack = function() {
					assert.ok(true, "IQ call back fired");
				};
				croc1.xmppCon.send(iq, iqCallBack);
				
				setTimeout(function() {
					session = croc1.data.send(config2.address, strData, {
						type: 'xmpp'
					});
				}, 2000);
				
				setTimeout(function() {
					assert.strictEqual(session.registerMessageReceipts, true, "expected value for registerMessageReceipts");
				}, 5000);
			} else {
				firstReady = true;
			}
		};

		croc1.presence.onSelfNotify = onReady;
		croc2.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("XMPP rich text (XHTML) send", 2, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
		// Have to specify NS to satisfy equality assertion
		var strData = '<strong xmlns="http://www.w3.org/1999/xhtml">XMPP test message</strong> ' + new Date();
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 10000);
		
		croc1.presence.start();
		croc2.presence.start();

		croc1.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
		};
		croc2.presence.onDisconnected = function () {
			// Make sure we're stopped
			this.stop();
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
			QUnit.start();
		};

		croc2.data.onXHTMLReceived = function (event) {
			// Check event object properties
			var s = new XMLSerializer();
			var receivedString = s.serializeToString(event.body);
			assert.strictEqual(event.address, config1.address, 'Expected address');
			assert.strictEqual(receivedString, strData, 'Expected string data');
			
			croc1.presence.stop();
			croc2.presence.stop();
			clearTimeout(hungTimerId);
			hungTimerId = null;
		};
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				croc1.data.sendXHTML(config2.address, strData, {
					type: 'xmpp'
				});
			} else {
				firstReady = true;
			}
		};

		croc1.presence.onSelfNotify = onReady;
		croc2.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});

}(jQuery));