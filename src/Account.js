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
	 * Retrieves the subscriber's current balance.
	 * 
	 * @param {CrocSDK.AccountAPI~balanceCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {function} error
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.getBalance = function(success, error) {
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

			if (error && typeof error === 'function') {
				error();
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
	 * @param {CrocSDK.AccountAPI~createConferenceCallback} success
	 * The callback function to run when a successful response is received.
	 * @param {function} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.createConference = function(success, error) {
		if (!success || typeof success !== 'function') {
			throw new TypeError("Missing success callback function");
		}

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

			if (error && typeof error === 'function') {
				error();
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("POST", url);
		xhr.send();
	};

	/**
	 * Ends a conference hosted on the Crocodile network.
	 * <p>
	 * Note that conferences normally end when the last participant leaves. This
	 * method is included to allow a conference to be ended early, kicking out
	 * any remaining participants.
	 * 
	 * @param {function} [success]
	 * The callback function to run when a successful response is received.
	 * @param {function} [error]
	 * The callback function to run when an error response is received.
	 */
	CrocSDK.AccountAPI.prototype.endConference = function(conferenceAddress,
			success, error) {
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

			if (error && typeof error === 'function') {
				error();
			}
		};
		xhr.onerror = error;
		xhr.ontimeout = error;
		xhr.open("DELETE", url);
		xhr.send();
	};

}(CrocSDK));
