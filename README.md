# Crocodile WebRTC SDK: JavaScript Library

Simplified web-based real-time communications built around WebRTC, SIP, MSRP, and XMPP.

## Getting Started
Download the [production version][min] or the [development version][max].

[min]: https://raw.github.com/crocodilertc/crocodile-rtc/master/dist/crocodile-rtc.min.js
[max]: https://raw.github.com/crocodilertc/crocodile-rtc/master/dist/crocodile-rtc.js

In your web page:

```html
<script src="jquery.js"></script>
<script src="dist/crocodile-rtc.min.js"></script>
<script>
	$(document).ready(function() {
		var croc = $.croc({
			apiKey: "abcdefghijklmnopqrst",
			onConnected: function() {
				// Ready to start communicating!
			}
		});
	});
</script>
```

## Dependencies

The only dependency required by the distributed library is jQuery.  The library has primarily been tested with jQuery 1.9.1.

The following libraries are "wrapped up" within the distributed library, and are thus required at build time:

* JsSIP (http://jssip.net) - currently using a custom branch available here: https://github.com/crocodilertc/JsSIP
* JSJaC (https://github.com/sstrigler/JSJaC) - currently using the unreleased commit with SHA 6c2d4f78d49f18aa8bd0f7c4c278b873d22c7451
* crocodile-msrp (https://code.google.com/p/crocodile-msrp/) - currently using v1.0.0

The unit testing also depends on QUnit (http://qunitjs.com/); v1.11.0 is included for convenience.

## Documentation
The documentation for the current release is available at http://www.crocodilertc.net/documentation

Alternatively, you can build the latest documentation directly from the JSDoc comments in the code; see [CONTRIBUTING.md][contrib] for instructions on building the code.

[contrib]: https://github.com/crocodilertc/crocodile-rtc/blob/master/CONTRIBUTING.md

## Examples
_(Coming soon)_

## Building/contributing
See [CONTRIBUTING.md][contrib]

## Release History

### v1.0 (2013-06-11)
* Initial public release
