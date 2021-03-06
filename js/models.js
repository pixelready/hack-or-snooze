'use strict';

const BASE_URL = 'https://hack-or-snooze-v3.herokuapp.com';

/******************************************************************************
 * Story: a single story in the system
 */

class Story {
	/** Make instance of Story from data object about story:
	 *   - {title, author, url, username, storyId, createdAt}
	 */

	constructor({ storyId, title, author, url, username, createdAt }) {
		this.storyId = storyId;
		this.title = title;
		this.author = author;
		this.url = url;
		this.username = username;
		this.createdAt = createdAt;
		this.oEmbed = '';
	}

	/** Parses hostname out of URL and returns it. */

	getHostName() {
		return new URL(this.url).host;
	}

	/** Returns a story instance given a storyId */

	static async getStory(storyId) {
		let story;
		story = storyList.stories.find(s => s.storyId === storyId);
		if (currentUser && story === undefined) {
			story = currentUser.favorites.find(s => s.storyId === storyId);
		}
		if (currentUser && story === undefined) {
			story = currentUser.ownStories.find(s => s.storyId === storyId);
		}
		if (currentUser && story === undefined) {
			const response = await axios.get(`${BASE_URL}/stories/${storyId}`, {
				params: { storyId: storyId },
			});
			story = new Story(response.data.story);
		}

		return story;
	}

	async getOembed() {
		const oEmbedUrl = oEmbedProviders.find(provider => {
			return new URL(provider.provider_url).host === this.getHostName()
		}).endpoints[0].url;
		const response = await axios.get(oEmbedUrl, {
			params: { url: this.url, format: 'json' },
		});
		this.oEmbed = response.data.html;
	}
}

/******************************************************************************
 * List of Story instances: used by UI to show story lists in DOM.
 */

class StoryList {
	constructor(stories) {
		this.stories = stories;
	}

	/** Generate a new StoryList. It:
	 *
	 *  - calls the API
	 *  - builds an array of Story instances
	 *  - makes a single StoryList instance out of that
	 *  - returns the StoryList instance.
	 */

	static async getStories() {
		// Note presence of `static` keyword: this indicates that getStories is
		//  **not** an instance method. Rather, it is a method that is called on the
		//  class directly. Why doesn't it make sense for getStories to be an
		//  instance method?

		// query the /stories endpoint (no auth required)
		const response = await axios({
			url: `${BASE_URL}/stories`,
			method: 'GET',
		});

		// turn plain old story objects from API into instances of Story class
		const stories = response.data.stories.map(story => new Story(story));

		// build an instance of our own class using the new array of stories
		return new StoryList(stories);
	}

	/** Adds story data to API, makes a Story instance, adds it to story list.
	 * - user - the current instance of User who will post the story
	 * - obj of {title, author, url}
	 *
	 * Returns the new Story instance
	 */

	async addStory(user, newStory) {
		console.log('addStory');

		const response = await axios({
			url: `${BASE_URL}/stories`,
			method: 'POST',
			data: {
				token: user.loginToken,
				story: {
					title: newStory.title,
					author: newStory.author,
					url: newStory.url,
				},
			},
		});

		const { story } = response.data;

		const addedStory = new Story(
			{
				title: story.title,
				author: story.author,
				url: story.url,
				storyId: story.storyId,
				username: story.username,
				createdAt: story.updatedAt,
			},
			response.data.token
		);

		this.stories.unshift(addedStory);

		return addedStory;
	}
}

/******************************************************************************
 * User: a user in the system (only used to represent the current user)
 */

class User {
	/** Make user instance from obj of user data and a token:
	 *   - {username, name, createdAt, favorites[], ownStories[]}
	 *   - token
	 */

	constructor(
		{ username, name, createdAt, favorites = [], ownStories = [] },
		token
	) {
		this.username = username;
		this.name = name;
		this.createdAt = createdAt;

		// instantiate Story instances for the user's favorites and ownStories
		this.favorites = favorites.map(s => new Story(s));
		this.ownStories = ownStories.map(s => new Story(s));

		// store the login token on the user so it's easy to find for API calls.
		this.loginToken = token;
	}

	/** Register new user in API, make User instance & return it.
	 *
	 * - username: a new username
	 * - password: a new password
	 * - name: the user's full name
	 */

	static async signup(username, password, name) {
		const response = await axios({
			url: `${BASE_URL}/signup`,
			method: 'POST',
			data: { user: { username, password, name } },
		});

		const { user } = response.data;

		return new User(
			{
				username: user.username,
				name: user.name,
				createdAt: user.createdAt,
				favorites: user.favorites,
				ownStories: user.stories,
			},
			response.data.token
		);
	}

	/** Login in user with API, make User instance & return it.

	 * - username: an existing user's username
	 * - password: an existing user's password
	 */

	static async login(username, password) {
		const response = await axios({
			url: `${BASE_URL}/login`,
			method: 'POST',
			data: { user: { username, password } },
		});

		const { user } = response.data;

		return new User(
			{
				username: user.username,
				name: user.name,
				createdAt: user.createdAt,
				favorites: user.favorites,
				ownStories: user.stories,
			},
			response.data.token
		);
	}

	/** When we already have credentials (token & username) for a user,
	 *   we can log them in automatically. This function does that.
	 */

	static async loginViaStoredCredentials(token, username) {
		try {
			const response = await axios({
				url: `${BASE_URL}/users/${username}`,
				method: 'GET',
				params: { token },
			});

			const { user } = response.data;

			return new User(
				{
					username: user.username,
					name: user.name,
					createdAt: user.createdAt,
					favorites: user.favorites,
					ownStories: user.stories,
				},
				token
			);
		} catch (err) {
			console.error('loginViaStoredCredentials failed', err);
			return null;
		}
	}

	/**
	 * Adds a favorite to the user instance and updates user favorites on server
	 * @param {*} story
	 */
	async addFavorite(story) {
		const favoriteStoryId = story.storyId;
		const response = await axios.post(
			`${BASE_URL}/users/${this.username}/favorites/${favoriteStoryId}`,
			{ token: currentUser.loginToken }
		);

		this.favorites.push(story);
	}

	/**
	 * Removes a favorite from the user instance
	 * and updates user favorites on server
	 * @param {*} story
	 */
	async removeFavorite(story) {
		const favoriteStoryId = story.storyId;
		const response = await axios.delete(
			`${BASE_URL}/users/${this.username}/favorites/${favoriteStoryId}`,
			{ data: { token: currentUser.loginToken } }
		);

		this.favorites = this.favorites.filter(
			story => story.storyId !== favoriteStoryId
		);
	}
}
