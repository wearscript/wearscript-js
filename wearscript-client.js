function WearScriptConnection(ws, group, device, onopen) {
    this.ws = ws;
    this.group = String(group);
    this.device = String(device);
    this.groupDevice = this.group + ':' + this.device;
    this._channelsInternal = {};
    this.deviceToChannels = {};
    this._externalChannels = {};
    this._onopen = onopen || function (event) {};

    this.exists = function (channel) {
	return channel == 'subscriptions' || !!this._exists(channel, this._externalChannels);
    }

    this.channelsInternal = function() {
	return this._keys(this._channelsInternal);
    }

    this.channelsExternal = function() {
	return this.deviceToChannels;
    }

    this.onopen = function (event) {
        console.log("wsclient: onopen");
        this.publish('subscriptions', this.groupDevice, this._keys(this._channelsInternal));
        this._onopen(event);
    }

    this.receive = function (event) {
	a = event;
	console.log('here:' + event)
        var reader = new FileReader();
        reader.addEventListener("loadend", function () {
            var data = msgpack.unpack(reader.result);
	    if (data[0] == 'subscriptions') {
		this.deviceToChannels[data[1]] = data[2];
		var externalChannels = {};
		for (var key in this.deviceToChannels) {
                    if (!this.deviceToChannels.hasOwnProperty(key))
                        continue;
		    var value = this.deviceToChannels[key];
		    for (var i = 0; i < value.length; i++) {
			externalChannels[value[i]] = true;
		    }
		}
		this._externalChannels = externalChannels;
	    }
	    var match = this._exists(data[0], this._channelsInternal);
            if (match) {
		match.apply(null, data);
            }
	}.bind(this));
        reader.readAsBinaryString(event.data);
    }
    ws.onopen = this.onopen.bind(this);
    ws.onmessage = this.receive.bind(this);

    this._exists = function (channel, container) {
	var channelCur = '';
	var parts = channel.split(':');
	var match;
	for (var i = 0; i < parts.length; i++) {
	    if (container.hasOwnProperty(channelCur))
		match = container[channelCur];
	    if (!i) {
		channelCur += parts[i];
	    } else {
		channelCur += ':' + parts[i];
	    }
	}
	if (container.hasOwnProperty(channelCur))
	    match = container[channelCur];
	return match;
    }
    this.channel = function () {
	return Array.prototype.slice.call(arguments).join(':');
    }

    this.subchannel = function () {
	return self.groupDevice + ':' + Array.prototype.slice.call(arguments).join(':')
    }

    this.ackchannel = function (channel) {
	return channel + ':ACK';
    }

    this._keys = function (obj) {
	var keys = [];
	for (var key in obj) if (obj.hasOwnProperty(key)) keys.push(key);
	return keys;
    }
    
    this.subscribe = function (channel, callback) {
	if (!this._channelsInternal.hasOwnProperty(channel)) {
	    this._channelsInternal[channel] = callback;
	    this.publish('subscriptions', this.groupDevice, this._keys(this._channelsInternal));
	} else {
	    this._channelsInternal[channel] = callback;
	}
	return this;
    }

    this.unsubscribe = function (channel) {
	if (this._channelsInternal.hasOwnProperty(channel)) {
	    delete this._channelsInternal[channel]
	    this.publish('subscriptions', this.groupDevice, this._keys(this._channelsInternal));
	}
	return this;
    }

    this.publish = function () {
        console.log(arguments[0]);
	if (!this.exists(arguments[0]) || this.ws.readyState != 1) {
	    return this;
	}
        console.log('Sending:' + arguments[0]);
	this.send.apply(this, arguments);
	return this;
    }

    this.send = function () {
	var data_enc = msgpack.pack(Array.prototype.slice.call(arguments));
	var data_out = new Uint8Array(data_enc.length);
	var i;
	for (i = 0; i < data_enc.length; i++) {
            data_out[i] = data_enc[i];
	}
	this.ws.send(data_out);
    }

    this.publish_retry = function (callback, retryTime, channel) {
        var args = Array.prototype.slice.call(arguments).slice(3);
	if (this._channelsInternal.hasOwnProperty(channel))
            return;
        console.log('pub_ret');
        if (retryTime < 200)
            retryTime = 200;
        var inner = function () {
            console.log('pub_ret0a');
	    if (!this._channelsInternal.hasOwnProperty(channel))
                return;
            console.log('pub_ret0b');
	    this.publish.apply(this, args);
            retryTime *= 2;
            if (retryTime > 30000)
                retryTime = 30000;
            window.setTimeout(inner, retryTime);
        }.bind(this);
        var listener = function () {
            console.log('pub_ret1');
            console.log('listener: result');
            this.unsubscribe(channel);
            callback.apply(null, Array.prototype.slice.call(arguments));
        }.bind(this);
        this.subscribe(channel, listener);
        inner();
    }

    this.subscribeTestHandler = function () {
        var callback = function () {
            var data = Array.prototype.slice.call(arguments);
            console.log('Test callback got...')
            console.log(data)
            if (data[1] == 'subscribe') {
                this.subscribe(data[2], callback);
            } else if (data[1] == 'unsubscribe') {
                this.unsubscribe(data[2]);
            } else if (data[1] == 'channelsInternal') {
                this.publish(data[2], this.channelsInternal());
            } else if (data[1] == 'channelsExternal') {
                this.publish(data[2], this.channelsExternal());
            } else if (data[1] == 'group') {
                this.publish(data[2], this.group);
            } else if (data[1] == 'device') {
                this.publish(data[2], this.device);
            } else if (data[1] == 'groupDevice') {
                this.publish(data[2], this.groupDevice);
            } else if (data[1] == 'exists') {
                this.publish(data[2], this.exists(data[3]));
            } else if (data[1] == 'publish') {
                this.publish.apply(this, data.slice(2));
            } else if (data[1] == 'channel') {
                this.publish(data[2], this.channel.apply(null, data.slice(3)));
            } else if (data[1] == 'subchannel') {
                this.publish(data[2], this.subchannel(data[3]));
            } else if (data[1] == 'ackchannel') {
                this.publish(data[2], this.ackchannel(data[3]));
            }
        }.bind(this);
        this.subscribe('test:' + this.groupDevice, callback);
    }
    // NOTE(brandyn): Loop and republish subscriptions to keep connection alive
    setInterval(function () {
	this.publish('subscriptions', this.groupDevice, this._keys(this._channelsInternal));
    }.bind(this), 60000);
}
