/*
 * Minimal Object Storage Library, (C) 2015 Minio, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var concat = require('concat-stream')
var crypto = require('crypto')
var http = require('http')
var parseXml = require('xml-parser')
var stream = require('stream')
var through = require('through')
var xml = require('xml')

class Client {
    constructor(params) {
        "use strict"
        this.transport = http
        this.params = params
    }

    createBucket(bucket, callback) {
        "use strict"

        var requestParams = {
            host: this.params.host,
            port: this.params.port,
            method: 'PUT',
            path: `/${bucket}`
        }

        signV4(requestParams, '', this.params.accessKey, this.params.secretKey)

        var req = this.transport.request(requestParams, response => {
            if (response.statusCode !== 200) {
                parseError(response, callback)
            } else {
                response.pipe(through(null, end))
            }
            function end() {
                callback()
            }
        })

        req.on('error', e => {
            callback(e)
        })

        req.end()
    }

    getObject(bucket, object, callback) {
        "use strict";

        var requestParams = {
            host: this.params.host,
            port: this.params.port,
            path: `/${bucket}/${object}`,
            method: 'GET',
        }

        signV4(requestParams, '', this.params.accessKey, this.params.secretKey)

        var req = http.request(requestParams, (response) => {
            if (response.statusCode !== 200) {
                return parseError(response, callback)
            }
            callback(null, response.pipe(through(write, end)))
            function write(chunk) {
                this.queue(chunk)
            }

            function end() {
                this.queue(null)
            }
        })
        req.end()
    }

    putObject(bucket, object, contentType, size, r, callback) {
        "use strict";

        if (contentType == null || contentType == '') {
            contentType = 'aplication/octet-stream'
        }

        var requestParams = {
            host: this.params.host,
            port: this.params.port,
            path: `/${bucket}/${object}`,
            method: 'PUT',
            headers: {
                "Content-Length": size,
                "Content-Type": contentType
            }
        }

        signV4(requestParams, '', this.params.accessKey, this.params.secretKey)

        var request = http.request(requestParams, (response) => {
            if (response.statusCode !== 200) {
                return parseError(response, callback)
            }
            response.pipe(through(null, end))
            function end() {
                callback()
            }
        })
        r.pipe(request)
    }
}

var parseError = (response, callback) => {
    "use strict";
    response.pipe(concat(errorXml => {
        var parsedXml = parseXml(errorXml.toString())
        var e = {}
        parsedXml.root.children.forEach(element => {
            if (element.name === 'Status') {
                e.status = element.content
            } else if (element.name === 'Message') {
                e.message = element.content
            } else if (element.name === 'RequestId') {
                e.requestid = element.content
            } else if (element.name === 'Resource') {
                e.resource = element.content
            }
        })
        callback(e)
    }))
}

var signV4 = (request, dataShaSum256, accessKey, secretKey) => {
    "use strict";

    if (!accessKey || !secretKey) {
        return
    }

    var requestDate = new Date()

    if (!dataShaSum256) {
        dataShaSum256 = 'df57d21db20da04d7fa30298dd4488ba3a2b47ca3a489c74750e0f1e7df1b9b7'
    }

    if (!request.headers) {
        request.headers = {}
    }

    request.headers['x-amz-date'] = requestDate.toISOString()
    request.headers['x-amz-content-sha256'] = dataShaSum256

    var canonicalRequest = getCanonicalRequest(request, dataShaSum256, requestDate)
    var hash = crypto.createHash('sha256')
    hash.update(canonicalRequest)
    var canonicalRequestHash = hash.digest('hex')

    var signingKey = getSigningKey(requestDate, getRegion(request.host), secretKey)

    var hmac = crypto.createHmac('sha256', signingKey)
    hmac.update(canonicalRequest)
    var signedRequest = hmac.digest('base64')

    request.headers['Authorization'] = signedRequest

    function getSigningKey(date, region, secretKey) {
        var keyLine = "AWS4" + secretKey + date
        var year = date.getYear()
        var month = date.getMonth() + 1
        if (month < 10) {
            month = `0${month}`
        }
        var day = date.getDate()
        var dateLine = `${year}${month}${day}`

        var hmac1 = crypto.createHmac('sha256', keyLine).update(dateLine).digest('binary')
        var hmac2 = crypto.createHmac('sha256', hmac1).update(region).digest('binary')
        var hmac3 = crypto.createHmac('sha256', hmac2).update("s3").digest('binary')
        return crypto.createHmac('sha256', hmac3).update("aws4_request").digest('binary')
    }

    function getRegion(host) {
        switch (host) {
            case "s3.amazonaws.com":
                return "us-east-1"
            case "s3-ap-northeast-1.amazonaws.com":
                return "ap-northeast-1"
            case "s3-ap-southeast-1.amazonaws.com":
                return "ap-southeast-1"
            case "s3-ap-southeast-2.amazonaws.com":
                return "ap-southeast-2"
            case "s3-eu-central-1.amazonaws.com":
                return "eu-central-1"
            case "s3-eu-west-1.amazonaws.com":
                return "eu-west-1"
            case "s3-sa-east-1.amazonaws.com":
                return "sa-east-1"
            case "s3.amazonaws.com":
                return "us-east-1"
            case "s3-external-1.amazonaws.com":
                return "us-east-1"
            case "s3-us-west-1.amazonaws.com":
                return "us-west-1"
            case "s3-us-west-2.amazonaws.com":
                return "us-west-2"
            default:
                return "milkyway"
        }
    }

    function getCanonicalRequest(request, dataShaSum1, requestDate) {


        var headers = []
        var signedHeaders = ""

        for (var key in request.headers) {
            if (request.headers.hasOwnProperty(key)) {
                key = key.trim().toLocaleLowerCase()
                var value = request.headers[key]
                headers.push(`${key}: ${value}`)
                if (signedHeaders) {
                    signedHeaders += ';'
                }
                signedHeaders += key
            }
        }

        headers.sort()

        var canonicalString = ""
        canonicalString += canonicalString + request.method.toUpperCase() + '\n'
        canonicalString += request.path + '\n'
        if (request.query) {
            canonicalString += request.query + '\n'
        } else {
            canonicalString += '\n'
        }
        headers.forEach(element => {
            canonicalString += element + '\n'
        })
        canonicalString += '\n'
        canonicalString += signedHeaders + '\n'
        canonicalString += dataShaSum1
        return canonicalString
    }
}

var inst = Client
module.exports = inst
