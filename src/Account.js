(function(CrocSDK) {
	/**
	 * The Account API allows a web-app to perform account management operations,
	 * such as checking the subscriber's balance.
	 * <p>
	 * Note that this API is only applicable when connected to the Crocodile
	 * network as a subscriber. If the API key in use does not support
	 * individual subscribers, attempts to use this API will fail. In this case,
	 * server-side API calls should be used instead; please refer to the
	 * {@link https://www.crocodilertc.net/documentation/rest REST API documentation}.
	 * <p>
	 * Once the {@link CrocSDK.Croc Croc} object is instantiated it will contain
	 * an instance of the Account API under the <code>account</code> property.
	 * <p>
	 * For example, given a {@link CrocSDK.Croc Croc} Object named
	 * <code>crocObject</code> the <code>getBalance</code> method would be
	 * available as <code>crocObject.account.getBalance</code>.
	 * 
	 * @constructor
	 * @memberof CrocSDK
	 * @param {CrocSDK.Croc} crocObject
	 * The parent {@link CrocSDK.Croc Croc} object.
	 */
	CrocSDK.AccountAPI = function(crocObject) {
		this.crocObject = crocObject;
		// TODO: get these from bootstrap configuration
		this.baseAccountUrl = "https://hub.crocodilertc.net:8443/crocodile-sdk-hub/rest/1.0/browser";
		this.baseConferenceUrl = "https://hub.crocodilertc.net:8443/conference-manager/rest/subscriber/v1/conferences";
	};

	/**
	 * Callback executed when a successful response is received for a
	 * {@link CrocSDK.AccountAPI.getBalance getBalance} request.
	 * @callback CrocSDK.AccountAPI~balanceCallback
	 * @param {string} currency
	 * The currency of the subscriber's balance, represented as the three-
	 * character ISO 4217 code.
	 * @param {number} balance
	 * The subscriber's current balance.
	 */

	/**
	 * Callback executed when an error response is received.
	 * @callback CrocSDK.AccountAPI~errorCallback
	 * @param {number} status
	 * The status code returned by the server.
	 * @param {string} message
	 * The error message returned by the server.
	 */

	/**
	 * Retrieves the subscriber's current balance.
	 * 
	 * @param {CrocSDK.AccountAPI~balanceCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} error
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.getBalance = function(success, error) {
		var crocObject = this.crocObject;
		var url = this.baseAccountUrl + "/balance";
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 200) {
				var resp = JSON.parse(this.response);
				if (resp.result === "OK") {
					success(resp.currency, resp.balance);
					return;
				}
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("GET", url);
		xhr.send();
	};

	/**
	 * Callback executed when a successful response is received for a
	 * {@link CrocSDK.AccountAPI.createConference createConference} request.
	 * @callback CrocSDK.AccountAPI~createConferenceCallback
	 * @param {string} conferenceAddress
	 * The address of the created conference.
	 */

	/**
	 * Creates a conference hosted on the Crocodile network.
	 * <p>
	 * Note that the simplest method for creating a conference is to call the
	 * {@link CrocSDK.MediaAPI.connect media.connect} method with a list of
	 * participants to invite; this method is included to allow more control
	 * for applications that require it.
	 * 
	 * @param {Object} config
	 * Configuration for the new conference. This can be null or an empty object
	 * to use the default configuration.
	 * @param {number} [config.layout]
	 * The layout to use for the conference. The following layouts are supported:
	 * <ul>
	 * <li>0: 1x1</li>
	 * <li>1: 2x2</li>
	 * <li>2: 3x3</li>
	 * <li>3: 3 large plus 4 small</li>
	 * <li>4: 1 large plus 7 small</li>
	 * <li>5: 1 large plus 5 small</li>
	 * <li>6: 2 large</li>
	 * <li>7: 1 picture-in-picture</li>
	 * <li>8: 3 pictures-in-picture</li>
	 * <li>9: 4x4</li>
	 * </ul>
	 * @param {CrocSDK.AccountAPI~createConferenceCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.createConference = function(config, success, error) {
		if (!success || typeof success !== 'function') {
			throw new TypeError("Missing success callback function");
		}

		var crocObject = this.crocObject;
		var url = this.baseConferenceUrl;
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 201) {
				var resp = JSON.parse(this.response);
				success(resp.conferenceAddress);
				return;
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("POST", url);
		xhr.setRequestHeader("Content-Type", "application/json");
		if (!config) {
			config = {};
		}
		xhr.send(JSON.stringify(config));
	};

	/**
	 * Callback executed when a successful response is received for a
	 * {@link CrocSDK.AccountAPI.listConferences listConferences} request.
	 * @callback CrocSDK.AccountAPI~listConferencesCallback
	 * @param {string[]} conferenceAddresses
	 * The list of conference addresses owned by the current subscriber.
	 */

	/**
	 * Lists the conferences hosted on the Crocodile network for the current
	 * subscriber.
	 * 
	 * @param {CrocSDK.AccountAPI~listConferencesCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.listConferences = function(success, error) {
		if (!success || typeof success !== 'function') {
			throw new TypeError("Missing success callback function");
		}

		var crocObject = this.crocObject;
		var url = this.baseConferenceUrl;
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 200) {
				var resp = JSON.parse(this.response);
				success(resp.conferenceAddresses);
				return;
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("GET", url);
		xhr.send();
	};

	/**
	 * Callback executed when a successful response is received for a
	 * {@link CrocSDK.AccountAPI.getConferenceDetails getConferenceDetails}
	 * request.
	 * @callback CrocSDK.AccountAPI~getConferenceDetailsCallback
	 * @param {Date} created
	 * The date and time the conference was created.
	 * @param {string} owner
	 * The creator/owner of the conference.
	 * @param {string[]} participantAddresses
	 * The list of addresses participating in this conference.
	 */

	/**
	 * Retrieves details of a conference hosted on the Crocodile network.
	 * <p>
	 * Only the conference owner is allowed to retrieve these details.
	 * 
	 * @param {string} conferenceAddress
	 * The address of the target conference.
	 * @param {CrocSDK.AccountAPI~getConferenceDetailsCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.getConferenceDetails = function(conferenceAddress,
			success, error) {
		if (!success || typeof success !== 'function') {
			throw new TypeError("Missing success callback function");
		}

		var crocObject = this.crocObject;
		var url = this.baseConferenceUrl + "/" + conferenceAddress;
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 200) {
				var resp = JSON.parse(this.response);
				success(new Date(resp.created), resp.owner,
						resp.participantAddresses);
				return;
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("GET", url);
		xhr.send();
	};

	/**
	 * Kicks a participant from a conference hosted on the Crocodile network.
	 * <p>
	 * Only the conference owner is allowed to kick participants.
	 * 
	 * @param {string} conferenceAddress
	 * The address of the target conference.
	 * @param {string} participantAddress
	 * The address of the target participant.
	 * @param {function} [success]
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.kickConferenceParticipant = function(
			conferenceAddress, participantAddress, success, error) {
		var crocObject = this.crocObject;
		var url = this.baseConferenceUrl;
		url += "/" + conferenceAddress + "/" + participantAddress;
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 204) {
				if (success && typeof success === 'function') {
					success();
				}
				return;
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("DELETE", url);
		xhr.send();
	};

	/**
	 * Ends a conference hosted on the Crocodile network.
	 * <p>
	 * Note that conferences normally end when the last participant leaves. This
	 * method is included to allow a conference to be ended early, kicking out
	 * any remaining participants.
	 * 
	 * @param {string} conferenceAddress
	 * The address of the target conference.
	 * @param {function} [success]
	 * The callback function to run when a successful response is received.
	 * @param {CrocSDK.AccountAPI~errorCallback} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.endConference = function(conferenceAddress,
			success, error) {
		var crocObject = this.crocObject;
		var url = this.baseConferenceUrl + "/" + conferenceAddress;
		var xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.timeout = 5000;
		// responseType = "json" is not yet working in Chrome stable (29),
		// though it is in Canary (31).
		xhr.responseType = "text";
		xhr.onload = function() {
			if (this.status === 204) {
				if (success && typeof success === 'function') {
					success();
				}
				return;
			}

			if (this.status === 403) {
				// Authentication failed - try re-auth
				crocObject.authManager.restart();
			}

			if (error && typeof error === 'function') {
				error(this.status, this.response);
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("DELETE", url);
		xhr.send();
	};

}(CrocSDK));
