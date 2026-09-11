// CloudFront Function (viewer-response) attached to the `*` behaviour of the
// production distribution E90FW67SOXKZN, which serves the marketing site.
//
// Why a Function and not a ResponseHeadersPolicy: the distribution is on
// CloudFront's Free pricing plan, which rejects custom response-headers
// policies outright —
//   "Distributions with the Free pricing plan can't have the following
//    features: Custom response headers policy"
// Functions are permitted, so the same headers are set here instead.
//
// Deliberately NOT attached to /presign or /result/*: those return JSON to the
// app, where a CSP protects nothing.
//
// The CSP mirrors the <meta> tag in website/*.html. Keep the two in step —
// frame-ancestors and HSTS are the parts a <meta> tag cannot express, which is
// the reason real headers are needed at all.

function handler(event) {
    var r = event.response;
    var h = r.headers;
    // Set on the viewer-response so they apply to every object the site serves,
    // including ones S3 returns without them. A <meta> CSP cannot express
    // frame-ancestors or HSTS, which is why these must be real headers.
    h['strict-transport-security'] = { value: 'max-age=31536000; includeSubDomains' };
    h['x-content-type-options']    = { value: 'nosniff' };
    h['x-frame-options']           = { value: 'DENY' };
    h['referrer-policy']           = { value: 'strict-origin-when-cross-origin' };
    h['content-security-policy']   = { value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self' https://formspree.io; form-action https://formspree.io; base-uri 'self'; object-src 'none'; frame-ancestors 'none'" };
    return r;
}
