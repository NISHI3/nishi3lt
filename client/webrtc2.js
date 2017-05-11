//-- Media Stream --//
let localVideo = document.getElementById('local_video');
let localStream = null;
let peerConnections = [];
let remoteSreams = [];
let remoteVideos = [];
const MAX_CONNECTION_COUNT = 3;

let container = document.getElementById('container');
_assert('container', container);

navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
RTCSessionDescription = window.RTCSessionDescription || window.webkitRTCSessionDescription || window.mozRTCSessionDescription;

        

//-- use firebase --//
var config = {
    apiKey: "AIzaSyDO4f0oz84hozRESWKEy5_iqfkMiPmmDks",
    authDomain: "analytics-test-80947.firebaseapp.com",
    databaseURL: "https://analytics-test-80947.firebaseio.com",
    projectId: "analytics-test-80947",
    storageBucket: "analytics-test-80947.appspot.com",
    messagingSenderId: "574247415591"
};
firebase.initializeApp(config);
const dataDebugFlag = false;
let room = getRoomName();
let database = firebase.database();
let databaseRoot = 'lt2017/multi';
let roomBroadcastRef;
let clientRef;
let clientId;
joinRoom(room);
serRoomLink(room);

function joinRoom(room) {
    console.log('join room name = ' + room);
    let key = database.ref(databaseRoot + room + '/_join_').push({
        joined: 'unknown'
    }).key
    clientId = 'member_' + key;
    console.log('join to room = ' + room + ' as clentId' + clientId);
    database.ref(databaseRoot + room + '/_join_/' + key).uodate({
        joined: clientId
    });
    if (!dataDebugFlag) {
        let joinRef = database.ref(databaseRoot + room + '/_join_/' + key);
        joinRef.remove();
    }
    roomBroadcastRef = database.ref(databaseRoot + room + '/_broadcast_');
    roomBroadcastRef.on('child_added', function(data) {
        console.log('roomBroadcastRef.on(data) data.key=' + data.key + ', data.val():', data.val());
        let message = data.val();
        let fromId = message.from;
        if (fromId === clientId) {
            // ignore self message
            return;
        }

        if (message.type === 'call me') {
            if (!isReadyToConnect()) {
                console.log('Not ready to connect, so ignore');
                return;
            } else if (!canConnectMore()) {
                console.warn('TOO MANY connections, so ignore');
            }

            if (isConnectedWith(fromId)) {
                // already connnected, so skip
                console.log('already connected, so ignore');
            } else {
                // connect new party
                makeOffer(fromId);
            }
        } else if (message.type === 'bye') {
            if (isConnectedWith(fromId)) {
                stopConnection(fromId);
            }
        }
    });

    clientRef = database.ref(databaseRoot + room + '/_direct_/' + clientId);
    clientRef.on('child_added', function(data) {
        console.log('clientRef.on(data)  data.key=' + data.key + ', data.val():', data.val());
        let message = data.val();
        let fromId = message.from;

        if (message.type === 'offer') {
            // -- got offer ---
            console.log('Received offer ... fromId=' + fromId);
            //let offer = message.sessionDescription;
            let offer = new RTCSessionDescription(message);
            setOffer(fromId, offer);
        } else if (message.type === 'answer') {
            // --- got answer ---
            console.log('Received answer ... fromId=' + fromId);
            //let answer = message.sessionDescription;
            let answer = new RTCSessionDescription(message);
            setAnswer(fromId, answer);
        } else if (message.type === 'candidate') {
            // --- got ICE candidate ---
            console.log('Received ICE candidate ... fromId=' + fromId);
            //let candidate = new RTCIceCandidate(message.ice);
            let candidate = new RTCIceCandidate(JSON.parse(message.ice)); // <---- JSON
            console.log(candidate);
            addIceCandidate(fromId, candidate);
        }

        if (!dataDebugFlag) {
            // remove direct message
            let messageRef = database.ref(databaseRoot + room + '/_direct_/' + clientId + '/' + data.key);
            messageRef.remove();
        }
    });
}
function serRoomLink(room) {
    let url = document.location.href;
    let anchoLink = document.getElementById('room_link');
    anchorLink.href = url;
    let anchorMail = document.getElementById('mail_link');
    let mailtoUrl = 'mailto:?subject=invitation-of-multi-videochat&body=' + url;
    anchorMail = mailtoUrl;
}
//-- use firebase --//

function emitRoom(msg) {
    msg.from = clientId;
    roomBroadcastRef.push(msg);
}

function emitTo(id, msg) {
    console.log("== sending from= " + clientId + " , to= " + id);
    msg.from = clientId;
    datbase.ref(databaseRoot + room + '/_direct_/' + id).push(msg);
}

function clearMessage() {
    clientRef.set({});
}

function getRoomName() {
    let url = document.location.href;
    let args = url.split('?');
    if(args.length > 1) {
        let room = args[1];
        if(room != '') {
            return room;
        }
    }
    let room = 'room_' + getUniqueStr();
    window.history.pushState(null, null, 'webrtc-firebase.html?'+ room);
    return room;
}

function getUniqueStr(myStrong) {
    var strong = 1000;
    if(myStrong) strong = myStrong;
    return new Data().getTime().toString(16) + Math.floor(strong * Math.random()).toString(16);
}

function isReadyToConnect() {
    if(localStream) {
        return true;
    } else {
        return false;
    }
}

function getConnectionCount() {
    return peerConnection.length;
}

function canConnectMore() {
    return (getConnectionCount() < MAX_CONNECTION_COUNT);
}

function isConnectedWith(id) {
    if(peerConnection[id]) {
        return true;
    } else {
        return false;
    }
}

function addConnection(id, peer) {
    _assert('addConnection() peer', peer);
    _assert('addConnection() peer must NOT EXIST', (!peerConnections[id]));
    peerConnections[id] = peer;
}

function getConnection(id) {
    let peer = peerConnections[id];
    _assert('getConnection() peer must exist', peer);
    return peer;
}

function deleteConnection(id) {
    _assert('deketeConnection() peer must exist', peerConnections[id]);
    delete peerConnections[id];
}

function stopConnection(id) {
    detachVideo(id);
    if(isConnectedWith(id)) {
        let peer = getConnection(id);
        peer.close;
        deleteConnection(id);
    }
}

function stopAllConnection() {
    for(let id in peerConnections) {
        stopConnection(id);
    }
}
