app.directive('roomTab', function (user, rooms) {
	return {
		scope: {
			roomId: '@roomTab'
		},
		templateUrl: '/assets/app/room/room.html',
		controller: function ($scope) {

			$scope.room = {
				userService: user,
				current: rooms.get($scope.roomId),
				memberLookup: {},
				now: function () {
					return moment().format('YYYY-MM-DD');
				},
				mentionUser: function (userNick) {
					$scope.$broadcast('inputText', '@' + userNick);
				}
			};

			// Watch for updates to the room members
			// Only applies to users who join the room for the first time or leave it entirely
			$scope.$watch('room.current.$members', function (newVal, oldVal) {
				if (!oldVal) return;
				$scope.room.memberLookup = _.indexBy($scope.room.current.$members, function (roomMember) {
					return roomMember.user.id;
				});
			}, true);

			// Watch for socket.io updates to users
			// Apply changes to our list of users, if they are in this room
			$scope.$on('$sailsResourceUpdated', function (evt, resource) {
				if (resource.model == 'user') {
					var roomMember = $scope.room.memberLookup[resource.id];
					if (roomMember) {
						angular.extend(roomMember.user, resource.data);
					}
				}
			});
		}
	};
});

app.filter('membersOrderBy', function () {
	return function (members) {
		return _(members)
			.sortBy(function (member) {
				return member.user.nick.toLowerCase();
			})
			.value();
	};
});
