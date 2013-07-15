(function (CrocSDK) {
	/**
	 * The CustomHeaders object can be used 
	 * to define headers to send in an outbound session request. Likewise, if any 
	 * custom headers are found in an inbound session request, these are available
	 * to the application in the same format.
	 * <p>
	 * There are no prescribed properties on a CustomHeaders object. Each
	 * property name that exists in the object will be mapped to a header name
	 * in the request, and each property value will be used as the associated
	 * header value.
	 * <p>
	 * All custom header keys <b><i>MUST</i></b> start with &#34;X-&#34;.
	 * Keys that do not start &#34;X-&#34; will be ignored.
	 * <p>
	 * When specifying custom headers to send, the header name can be provided
	 * with any chosen capitalisation, as long as it only uses valid characters
	 * (sticking to alphanumeric characters and dashes is recommended). However,
	 * the names of received custom headers are always provided in a specific
	 * format: with only the first character, and each character following
	 * a dash, in uppercase. For instance, a header sent as
	 * &#34;x-lowercase&#34; will be received as &#34;X-Lowercase&#34;.
	 * 
	 * @memberof CrocSDK
	 * @typedef CrocSDK~CustomHeaders
	 */
	CrocSDK.CustomHeaders = function (customHeaders) {
		if (customHeaders instanceof JsSIP.IncomingRequest) {
			this.fromSipRequest(customHeaders);
		} else if (customHeaders) {
			var name, value;
			for (name in customHeaders) {
				value = customHeaders[name];
				if (this.isValidCustomHeader(name, value)) {
					this[name] = value;
				} else {
					console.warn('Ignored custom header:', name, value);
				}
			}
		}
	};

	CrocSDK.CustomHeaders.prototype.isValidCustomHeader = function (name, value) {
		var token = /[^a-zA-Z0-9\-\.!%\*_\+`'~]/;
		if (name.slice(0, 2).toUpperCase() !== 'X-') {
			return false;
		}

		if (name.match(token)) {
			return false;
		}
		
		if (!CrocSDK.Util.isType(value, 'string')) {
			return false;
		}
		
		// Though they can be valid, ban new lines/carriage returns for safety
		if (value.match(/[\r\n]/)) {
			return false;
		}

		return true;
	};

	CrocSDK.CustomHeaders.prototype.equals = function (customHeaders) {
		var keys = Object.keys(this); 
		if (keys.length !== Object.keys(customHeaders).length) {
			return false;
		}

		for (var i = 0, len = keys.length; i < len; i++) {
			var name = keys[i];

			if (customHeaders[name] !== this[name]) {
				return false;
			}
		}

		return true;
	};

	CrocSDK.CustomHeaders.prototype.fromSipRequest = function (sipRequest) {
		for (var name in sipRequest.headers) {
			if (name.slice(0, 2).toUpperCase() === 'X-') {
				// We only grab the first instance of a given header name
				var value = sipRequest.headers[name][0].raw;
				if (this.isValidCustomHeader(name, value)) {
					this[name] = value;
				} else {
					console.warn('Ignored custom header:', name, value);
				}
			}
		}
	};

	/**
	 * Produces an array of "extra headers" as used by JsSIP.
	 * @returns {Array}
	 * @private
	 */
	CrocSDK.CustomHeaders.prototype.toExtraHeaders = function () {
		var extraHeaders = [];
		var keys = Object.keys(this);
		
		for (var i = 0, len = keys.length; i < len; i++) {
			var name = keys[i];
			var value = this[name];
			
			if (this.isValidCustomHeader(name, value)) {
				extraHeaders.push(name + ': ' + value);
			} else {
				console.warn('Ignored invalid custom header:', name, value);
			}
		}
		
		return extraHeaders;
	};

	CrocSDK.CustomHeaders.prototype.isEmpty = function () {
		var keys = Object.keys(this);
		return keys.length === 0;
	};

}(CrocSDK));
