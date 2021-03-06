var ent = require('ent');
var Promise = require('bluebird');

var ForbiddenError = require('../errors/ForbiddenError');
var InvalidInputError = require('../errors/InvalidInputError');

module.exports.createMessage = function (roomMember, text) {

	text = ent.encode(text);

	if (!text || !text.length) {
		throw new InvalidInputError(); // block the trolls
	}
	else if (/^\/nick\s+/i.test(text)) {
		return setUserNick(roomMember, text); // Change the current user's nick
	}
	else if (/^\/(away|afk|busy)/i.test(text)) {
		return setUserBusy(roomMember, text); // away, afk, busy (with optional message)
	}
	else if (/^\/help/i.test(text)) {
		return getHelp(roomMember, text);
	}
	else if (/^\/topic/i.test(text)) { // Change room topic
		return setRoomTopic(roomMember, text);
	}
	else if (/^\/room\s+topic/i.test(text)) {
		return setRoomTopic(roomMember, text)
	}
	else if (/^\/room\s+name\s+\w/i.test(text)) {
		return setRoomName(roomMember, text)
	}
	else if (/^\/magic8ball/i.test(text)) {
		return magic8ball(roomMember, text); // Jordan's Magic 8 Ball, Bitches
	}
	else if (/^\/roll/i.test(text)) {
		return roll(roomMember, text);
	}
	else if (/^\/me\s+/i.test(text)) {
		return me(roomMember, text);
	}
	else {
		return message(roomMember, text, 'standard');
	}
};

module.exports.broadcastMessage = broadcastMessage;

function getHelp(roomMember, text) {
	return helpService.getHelp(text).then(function (helpMessage) {
		RoomService.messageUserInRoom(roomMember.user.id, roomMember.room, helpMessage, 'help');
	});
}

function setUserNick(roomMember, text) {
	var nickMatches = text.match(/^\/nick\s+(\w[\w\s\-\.]{0,19})/i);
	if (!nickMatches) throw new InvalidInputError('Invalid nick');

	var user = roomMember.user;
	var newNick = nickMatches[1];
	if (user.nick == newNick) throw new InvalidInputError('Nick is already set');

	return Promise.all([
		User.update(user.id, {nick: newNick}),
		RoomMember.find({user: user.id})
	])
		.spread(function (updatedUser, memberships) {
			updatedUser = updatedUser[0];
			User.publishUpdate(user.id, {nick: updatedUser.nick});
			RoomService.messageRooms(_.pluck(memberships, 'room'), user.nick + ' changed their handle to ' + updatedUser.nick);
		});
}

function setUserBusy(roomMember, text) {
	return RoomMember.find({user: roomMember.user.id})
		.then(function (memberships) {
			var user = roomMember.user;
			return [User.update(user.id, {busy: !user.busy}), memberships];
		})
		.spread(function (user, memberships) {
			user = user[0];

			var message = user.nick + ' is ' + (user.busy ? 'now away' : 'back');
			var awayMessageMatches = text.match(/^\/(?:away|afk|busy)\s*(.+)/i);
			if (user.busy && awayMessageMatches) {
				message += ': ' + awayMessageMatches[1];
			}

			RoomService.messageRooms(_.pluck(memberships, 'room'), message);
			User.publishUpdate(user.id, {busy: user.busy});
		});
}

function setRoomTopic(roomMember, text) {

	if (roomMember.role == 'member') {
		throw new ForbiddenError('Must be an administrator to change topic');
	}

	var user = roomMember.user;
	var roomId = roomMember.room;
	var topicMatches = text.match(/topic\s+(.+)/i);
	var topic = topicMatches ? topicMatches[1].substr(0, 200) : null;

	return Room.update(roomId, {topic: topic}).then(function (room) {
		room = room[0];
		var message = user.nick + (room.topic ? ' changed the topic to "' + room.topic + '"' : ' cleared the topic');

		Room.publishUpdate(roomId, {topic: room.topic});
		RoomService.messageRoom(roomId, message);
	});
}

function setRoomName(roomMember, text) {

	if (roomMember.role == 'member') {
		throw new ForbiddenError('Must be an administrator to change room name');
	}

	var user = roomMember.user;
	var roomId = roomMember.room;

	var nameMatches = text.match(/\/room\s+name\s+([\w\s]+)/i);
	if (!nameMatches) throw new InvalidInputError('Invalid room name');

	var name = nameMatches[1].substr(0, 50);

	return Room.update(roomId, {name: name}).then(function (room) {
		room = room[0];
		var message = user.nick + ' changed the room name to "' + room.name + '"';

		Room.publishUpdate(roomId, {name: room.name});
		RoomService.messageRoom(roomId, message);
	});
}

function magic8ball(roomMember, text) {
	var ballResponse = _.sample([
		"It is certain", "It is decidedly so", "Yes definitely",
		"You may rely on it", "As I see it, yes",
		"Most likely", "Outlook good", "Yes", "Signs point to yes", "Without a doubt",
		"Ask again later", "Better not tell you now",
		"Cannot predict now", "Concentrate and ask again", "Reply hazy, try again",
		"Don't count on it", "My reply is no",
		"My sources say no", "Outlook not so good", "Very doubtful"
	]);

	setTimeout(function () {
		return Message.create({
			room: roomMember.room,
			author: null,
			type: '8ball',
			text: ':magic8ball: ' + ballResponse
		}).then(broadcastMessage);
	}, 3000);

	var question = ' shakes the magic 8 ball...';
	var questionMatch = text.match(/\/magic8ball\s+(.+)/i);
	if (questionMatch) {
		question = ' shakes the magic 8 ball and asks "' + questionMatch[1] + '"';
	}

	return message(roomMember, roomMember.user.nick + question, 'room');
}

function roll(roomMember, text) {
	var matches = text.match(/\/roll\s+(.+)/i);
	var roll = matches ? matches[1] : null;

	// Determine outcome
	var rollOutcome;

	if (_.isNumber(+roll) && !_.isNaN(+roll)) {
		var max = +roll;
		rollOutcome = 'rolled ' + Math.ceil(Math.random() * max) + ' out of ' + max;
	}
	// d20 case for D&D nerds
	//else if(/^d\d{1,4}/i.test(roll)) { // a dice roll
	//	rollOutcome = 'rolled a ' + roll + ' for ' + 100;
	//}
	else { // Doesn't fit any of our cases
		return;
	}

	return message(roomMember, roomMember.user.nick + ' ' + rollOutcome, 'roll');
}

function me(roomMember, text) {
	return message(roomMember, roomMember.user.nick + text.substring(3), 'emote');
}

function message(roomMember, text, type) {

	type = type || 'standard';

	return Message.create({
		room: roomMember.room,
		type: type,
		author: type == 'standard' ? roomMember.user : null,
		text: text
	}).then(function (message) {
		broadcastMessage(message);
		saveInMentionedInboxes(message);
		return message;
	});
}

function broadcastMessage(message) {
	// now that message has been created, get the populated version
	return Message.findOne(message.id).populateAll().exec(function (error, message) {
		Room.message(message.room, message); // message all subscribers of the room that with the new message as data
	});
}

function saveInMentionedInboxes(message) {
	if(!message.author) return;

	// Check if this message mentions anyone
	// Completely async process that shouldn't disrupt the normal message flow
	return Promise.all([
		User.findOne(message.author),
		RoomMember.find({room: message.room}).populate('user')
	])
		.spread(function (author, roomMembers) {
			return Promise.each(roomMembers, function (roomMember) {
				var regex = new RegExp(roomMember.user.nick + '\\b|@[Aa]ll', 'i');
				if (regex.test(message.text)) {
					return InboxMessage.create({user: roomMember.user.id, message: message.id})
						.then(function (inboxMessage) {
							return InboxMessage.findOne(inboxMessage.id).populateAll();
						})
						.then(function (inboxMessage) {
							inboxMessage.message.author = author; // Attach populated author data
							InboxMessage.message(roomMember.user.id, inboxMessage);
						});
				}
			})
		});
}
