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
		start: false,
		xmppResource : 'unittest'
	};
	var config2 = {
		apiKey: testApiKey,
		address: testUsers[1].address,
		password: testUsers[1].password,
		displayName: 'Unit Tester #2',
		start: false,
		xmppResource : 'unittest'
	};
	
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
					if (hungTimerId) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
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
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
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
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
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
		var nextStep = 0;
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
		//  Cleanup

		croc1.presence.onContactsReceived = function (event) {
			// Step 0
			removeExistingContacts(event.contacts);

			// Delay contact add just to make debug clearer
			setTimeout(function () {
				// Step 1: Add contact with subscribe enabled by default
				croc1.presence.addContact(config2.address, {watchApproved: false});
				nextStep = 1;
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
			nextStep = 6;
		};

		croc2.presence.onWatchRequest = function (event) {
			// Step 3b
			assert.strictEqual(event.address, config1.address, '3b: address');
			assert.strictEqual(event.status, null, '3b: status');
			watchRequestEvent = event;

			if (watch) {
				event.accept();
				nextStep = 4;
			}
		};

		croc2.presence.onNewContact = function (event) {
			// Step 4b
			contact2 = event.contact;
			assert.strictEqual(contact2.address, config1.address, '4b: address');
			assert.strictEqual(contact2.name, null, '4b: empty name');
			assert.deepEqual(contact2.groups, [], '4b: empty groups');

			contact2.onRemove = function () {
				croc1.presence.stop();
				croc2.presence.stop();
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
			};

			if (watchBack) {
				// We're ready for the next step
				contact2.watch();
				nextStep = 5;
			}
		};

		croc1.presence.onNewContact = function (event) {
			// Step 2
			contact1 = event.contact;
			assert.strictEqual(contact1.address, config2.address, '2: address');
			assert.strictEqual(contact1.name, null, '2: empty name');
			assert.deepEqual(contact1.groups, [], '2: empty groups');
			nextStep = 3;

			// This should also be testing pre-approval, but that does not seem
			// to be supported by ejabberd.
			contact1.onUpdate = function () {
				if (nextStep === 3) {
					// Step 3a
					assert.strictEqual(contact1.watching, false, '3a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '3a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '3a: watching me');
					assert.strictEqual(contact1.watchPending, true, '3a: watch pending');
					// Now accept the watch request
					if (watchRequestEvent) {
						watchRequestEvent.accept();
						nextStep = 4;
					} else {
						watch = true;
					}
				} else if (nextStep === 4) {
					// Step 4a
					assert.strictEqual(contact1.watching, true, '4a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '4a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '4a: watching me');
					assert.strictEqual(contact1.watchPending, false, '4a: watch pending');
					// Now contact returns the favour
					if (contact2) {
						contact2.watch();
						nextStep = 5;
					} else {
						watchBack = true;
					}
				} else if (nextStep === 6) {
					// Step 6
					assert.strictEqual(contact1.watching, true, '6: watching');
					assert.strictEqual(contact1.watchingApproved, false, '6: watching approved');
					assert.strictEqual(contact1.watchingMe, true, '6: watching me');
					assert.strictEqual(contact1.watchPending, false, '6: watch pending');
					// Then stop watching
					contact1.unwatch();
					nextStep = 7;
				} else if (nextStep === 7) {
					// Step 7
					assert.strictEqual(contact1.watching, false, '7: watching');
					assert.strictEqual(contact1.watchingApproved, false, '7: watching approved');
					assert.strictEqual(contact1.watchingMe, true, '7: watching me');
					assert.strictEqual(contact1.watchPending, false, '7: watch pending');
					// Then stop them watching me
					contact1.denyWatch();
					nextStep = 8;
				} else if (nextStep === 8) {
					// Step 8
					assert.strictEqual(contact1.watching, false, '8: watching');
					assert.strictEqual(contact1.watchingApproved, false, '8: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '8: watching me');
					assert.strictEqual(contact1.watchPending, false, '8: watch pending');
					// Clean up
					contact1.remove();
					contact2.remove();
				}
			};
		};
		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Two-way subscription with getContacts", 35, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var watchRequestEvent = null;
		var contact1 = null;
		var contact2 = null;
		var nextStep = 0;
		var watch = false;
		var watchBack = false;
		var TEST_AVAILABILITY = 'away';
		var TEST_STATUS = 'Cooking dinner';
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
		//  User 2 sets presence info
		// Step 7: User1 receives presence info
		//  User1 calls getContacts to refresh roster
		// Step 8: User1 receives roster, showing two-way subscribe (including presence info)
		//  Cleanup

		croc1.presence.onContactsReceived = function (event) {
			if (nextStep === 0) {
				// Step 0
				removeExistingContacts(event.contacts);

				// Delay contact add just to make debug clearer
				setTimeout(function () {
					// Step 1: Add contact with subscribe enabled by default
					croc1.presence.addContact(config2.address, {watchApproved: false});
					nextStep = 1;
				}, 2000);
			} else if (nextStep === 8) {
				// Step 8
				assert.strictEqual(event.contacts.length, 1, nextStep + ': Expected number of contacts');
				contact1 = event.contacts[0];
				// Roster info unchanged
				assert.strictEqual(contact1.watching, true, nextStep + ': watching');
				assert.strictEqual(contact1.watchingApproved, false, nextStep + ': watching approved');
				assert.strictEqual(contact1.watchingMe, true, nextStep + ': watching me');
				assert.strictEqual(contact1.watchPending, false, nextStep + ': watch pending');
				// Presence info still intact
				assert.strictEqual(contact1.availability, TEST_AVAILABILITY, nextStep + ': availability');
				assert.strictEqual(contact1.status, TEST_STATUS, nextStep + ': status');
				// Clean up
				contact1.remove();
				contact2.remove();
			}
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
			nextStep = 6;
		};

		croc2.presence.onWatchRequest = function (event) {
			// Step 3b
			assert.strictEqual(event.address, config1.address, '3b: address');
			assert.strictEqual(event.status, null, '3b: status');
			watchRequestEvent = event;

			if (watch) {
				event.accept();
				nextStep = 4;
			}
		};

		croc2.presence.onNewContact = function (event) {
			// Step 4b
			contact2 = event.contact;
			assert.strictEqual(contact2.address, config1.address, '4b: address');
			assert.strictEqual(contact2.name, null, '4b: empty name');
			assert.deepEqual(contact2.groups, [], '4b: empty groups');

			contact2.onRemove = function () {
				croc1.presence.stop();
				croc2.presence.stop();
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
			};

			if (watchBack) {
				// We're ready for the next step
				contact2.watch();
				nextStep = 5;
			}
		};

		croc1.presence.onNewContact = function (event) {
			// Step 2
			contact1 = event.contact;
			assert.strictEqual(contact1.address, config2.address, '2: address');
			assert.strictEqual(contact1.name, null, '2: empty name');
			assert.deepEqual(contact1.groups, [], '2: empty groups');
			nextStep = 3;

			// This should also be testing pre-approval, but that does not seem
			// to be supported by ejabberd.
			contact1.onUpdate = function () {
				if (nextStep === 3) {
					// Step 3a
					assert.strictEqual(contact1.watching, false, '3a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '3a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '3a: watching me');
					assert.strictEqual(contact1.watchPending, true, '3a: watch pending');
					// Now accept the watch request
					if (watchRequestEvent) {
						watchRequestEvent.accept();
						nextStep = 4;
					} else {
						watch = true;
					}
				} else if (nextStep === 4) {
					// Step 4a
					assert.strictEqual(contact1.watching, true, '4a: watching');
					assert.strictEqual(contact1.watchingApproved, false, '4a: watching approved');
					assert.strictEqual(contact1.watchingMe, false, '4a: watching me');
					assert.strictEqual(contact1.watchPending, false, '4a: watch pending');
					// Now contact returns the favour
					if (contact2) {
						contact2.watch();
						nextStep = 5;
					} else {
						watchBack = true;
					}
				} else if (nextStep === 6) {
					// Step 6
					assert.strictEqual(contact1.watching, true, '6: watching');
					assert.strictEqual(contact1.watchingApproved, false, '6: watching approved');
					assert.strictEqual(contact1.watchingMe, true, '6: watching me');
					assert.strictEqual(contact1.watchPending, false, '6: watch pending');
					// Then user 2 sets presence info
					croc2.presence.publishPresence({
						availability: TEST_AVAILABILITY,
						status: TEST_STATUS
					});
					nextStep = 7;
				}
			};

			contact1.onNotify = function () {
				if (nextStep === 7) {
					// Step 7
					// Roster info unchanged
					assert.strictEqual(contact1.watching, true, nextStep + ': watching');
					assert.strictEqual(contact1.watchingApproved, false, nextStep + ': watching approved');
					assert.strictEqual(contact1.watchingMe, true, nextStep + ': watching me');
					assert.strictEqual(contact1.watchPending, false, nextStep + ': watch pending');
					// Presence info updated
					assert.strictEqual(contact1.availability, TEST_AVAILABILITY, nextStep + ': availability');
					assert.strictEqual(contact1.status, TEST_STATUS, nextStep + ': status');
					// Now request a roster refresh
					croc1.presence.getContacts();
					nextStep++;
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
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
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
	
	QUnit.asyncTest("XMPP send with chat notifications", 5, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
		var session = null;
		var numNotifications = 0;
		var strData = 'XMPP test message ' + new Date();
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			croc2.presence.stop();
			hungTimerId = null;
		}, 30000);
		var idleTimerId = null;
		
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
			event.session.onComposingStateChange = function (event) {
				numNotifications++;
				if (numNotifications === 1) {
					assert.strictEqual(event.state, 'composing', 'croc1 is composing');
					idleTimerId = setTimeout(function () {
						assert.ok(false, 'No idle notification');
					}, 16000);
				} else if (numNotifications === 2) {
					clearTimeout(idleTimerId);
					assert.strictEqual(event.state, 'idle', 'croc1 is idle (timeout)');
					session.setComposingState('composing');
				} else if (numNotifications === 3) {
					assert.strictEqual(event.state, 'composing', 'croc1 is composing');
					session.setComposingState('idle');
				} else if ( numNotifications === 4) {
					assert.strictEqual(event.state, 'idle', 'croc1 is idle (forced)');
					session.close();
				} else {
					assert.ok(false, 'Unexpected number of notifications');
				}
			};
			session.onClose = function () {
				assert.ok(true, "onClose fired");
				
				croc1.presence.stop();
				croc2.presence.stop();
				if (hungTimerId) {
					clearTimeout(hungTimerId);
					hungTimerId = null;
				}
			};
		};
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				session = croc1.data.send(config2.address, strData, {
					type: 'xmpp'
				});
				session.onComposingStateChange = function () {
					assert.ok(false, 'croc2 composing state changed');
				};
				session.setComposingState('composing');
			} else {
				firstReady = true;
			}
		};

		croc1.presence.onSelfNotify = onReady;
		croc2.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});
	
	QUnit.asyncTest("XMPP send with delivery receipts", 1, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
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
		
		var onReady = function () {
			if (firstReady) {
				// Both now connected
				croc1.data.send(config2.address, strData, {
					type: 'xmpp',
					onSuccess: function () {
						assert.ok(true, "xmpp onSuccess fired");
						croc1.presence.stop();
						croc2.presence.stop();
						if (hungTimerId) {
							clearTimeout(hungTimerId);
							hungTimerId = null;
						}
					}
				});
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
			if (hungTimerId) {
				clearTimeout(hungTimerId);
				hungTimerId = null;
			}
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

	QUnit.asyncTest("XMPP send to offline user", 1, function(assert) {
		var croc1 = $.croc(config1);
		var strData = 'XMPP test message ' + new Date() + '\n';
		strData += '<>&£äâãéèЖ';
		// Give up if the test has hung for too long
		var hungTimerId = setTimeout(function() {
			assert.ok(false, 'Aborting hung test');
			croc1.presence.stop();
			hungTimerId = null;
		}, 10000);

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

		croc1.data.onData = function () {
			assert.ok(false, 'onData fired for error message');
		};

		var onReady = function () {
			croc1.data.send(config2.address, strData, {
				type: 'xmpp',
				onFailure: function () {
					assert.ok(true, 'onFailure fired');

					croc1.presence.stop();
					if (hungTimerId) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
				}
			});
		};

		croc1.presence.onSelfNotify = onReady;

		// QUnit will restart once the second croc object has disconnected
	});

	QUnit.asyncTest("Service discovery response", 7, function(assert) {
		var croc1 = $.croc(config1);
		var croc2 = $.croc(config2);
		var firstReady = false;
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

		var onReady = function () {
			if (firstReady) {
				// Both now connected
				// Not a supported API, internal testing only
				var iq = new JSJaCIQ();
				iq.setIQ(config2.address + '/' + config2.xmppResource, 'get', null);
				iq.setQuery('http://jabber.org/protocol/disco#info');
				croc1.xmppCon.send(iq, function (response) {
					assert.ok(true, 'Received response');
					assert.strictEqual(response.getType(), 'result', 'Expected type');
					var queryNode = response.getQuery();
					if (queryNode) {
						assert.strictEqual(queryNode.namespaceURI,
								'http://jabber.org/protocol/disco#info',
								'Expected query NS');
						var childNodes = queryNode.childNodes;
						var features= [];
						var unexpectedChild = false;
						for (var i = 0, len = childNodes.length; i < len; i++) {
							var child = childNodes.item(i);
							if (child.tagName === 'feature') {
								features.push(child.getAttribute('var'));
							} else {
								unexpectedChild = true;
							}
						}
						assert.strictEqual(unexpectedChild, false, 'No unexpected child nodes');
						assert.ok(features.indexOf('urn:xmpp:receipts') !== -1, 'Supports receipts');
						assert.ok(features.indexOf('http://jabber.org/protocol/chatstates') !== -1, 'Supports chat states');
						assert.ok(features.indexOf('http://jabber.org/protocol/xhtml-im') !== -1, 'Supports XHTML-IM');
					} else {
						assert.ok(false, 'No query node');
					}

					croc1.presence.stop();
					croc2.presence.stop();
					if (hungTimerId) {
						clearTimeout(hungTimerId);
						hungTimerId = null;
					}
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
