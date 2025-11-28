import { create } from "zustand";
import { Song } from "@/types";
import { useChatStore } from "./useChatStore";
import { useMLStore } from "./useMLStore";
import { useMusicStore } from "./useMusicStore";

interface PlayerStore {
	currentSong: Song | null;
	isPlaying: boolean;
	queue: Song[];
	currentIndex: number;
	useMLRecommendations: boolean;
	mlReferenceSong: Song | null;
	mlUsedRecommendations: string[];

	initializeQueue: (songs: Song[]) => void;
	playAlbum: (songs: Song[], startIndex?: number) => void;
	setCurrentSong: (song: Song | null) => void;
	togglePlay: () => void;
	playNext: () => void;
	playPrevious: () => void;
	setUseMLRecommendations: (use: boolean) => void;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
	currentSong: null,
	isPlaying: false,
	queue: [],
	currentIndex: -1,
	useMLRecommendations: false,
	mlReferenceSong: null,
	mlUsedRecommendations: [],

	initializeQueue: (songs: Song[]) => {
		set({
			queue: songs,
			currentSong: get().currentSong || songs[0],
			currentIndex: get().currentIndex === -1 ? 0 : get().currentIndex,
		});
	},

	playAlbum: (songs: Song[], startIndex = 0) => {
		if (songs.length === 0) return;

		const song = songs[startIndex];

		const socket = useChatStore.getState().socket;
		if (socket.auth) {
			socket.emit("update_activity", {
				userId: socket.auth.userId,
				activity: `Playing ${song.title} by ${song.artist}`,
			});
		}
		set({
			queue: songs,
			currentSong: song,
			currentIndex: startIndex,
			isPlaying: true,
			mlReferenceSong: song,
			mlUsedRecommendations: [],
		});
	},

	setCurrentSong: (song: Song | null) => {
		if (!song) return;

		const socket = useChatStore.getState().socket;
		if (socket.auth) {
			socket.emit("update_activity", {
				userId: socket.auth.userId,
				activity: `Playing ${song.title} by ${song.artist}`,
			});
		}

		const songIndex = get().queue.findIndex((s) => s._id === song._id);
		set({
			currentSong: song,
			isPlaying: true,
			currentIndex: songIndex !== -1 ? songIndex : get().currentIndex,
			mlReferenceSong: song,
			mlUsedRecommendations: [],
		});
	},

	togglePlay: () => {
		const willStartPlaying = !get().isPlaying;

		const currentSong = get().currentSong;
		const socket = useChatStore.getState().socket;
		if (socket.auth) {
			socket.emit("update_activity", {
				userId: socket.auth.userId,
				activity:
					willStartPlaying && currentSong ? `Playing ${currentSong.title} by ${currentSong.artist}` : "Idle",
			});
		}

		set({
			isPlaying: willStartPlaying,
		});
	},

	playNext: () => {
		const { currentIndex, queue, useMLRecommendations, mlReferenceSong } = get();
		
		if (useMLRecommendations && mlReferenceSong) {
			playNextWithML();
			return;
		}
		
		const nextIndex = currentIndex + 1;

		// if there is a next song to play, let's play it
		if (nextIndex < queue.length) {
			const nextSong = queue[nextIndex];

			const socket = useChatStore.getState().socket;
			if (socket.auth) {
				socket.emit("update_activity", {
					userId: socket.auth.userId,
					activity: `Playing ${nextSong.title} by ${nextSong.artist}`,
				});
			}

			set({
				currentSong: nextSong,
				currentIndex: nextIndex,
				isPlaying: true,
			});
		} else {
			// no next song
			set({ isPlaying: false });

			const socket = useChatStore.getState().socket;
			if (socket.auth) {
				socket.emit("update_activity", {
					userId: socket.auth.userId,
					activity: `Idle`,
				});
			}
		}
	},
	playPrevious: () => {
		const { currentIndex, queue } = get();
		const prevIndex = currentIndex - 1;

		// theres a prev song
		if (prevIndex >= 0) {
			const prevSong = queue[prevIndex];

			const socket = useChatStore.getState().socket;
			if (socket.auth) {
				socket.emit("update_activity", {
					userId: socket.auth.userId,
					activity: `Playing ${prevSong.title} by ${prevSong.artist}`,
				});
			}

			set({
				currentSong: prevSong,
				currentIndex: prevIndex,
				isPlaying: true,
			});
		} else {
			// no prev song
			set({ isPlaying: false });

			const socket = useChatStore.getState().socket;
			if (socket.auth) {
				socket.emit("update_activity", {
					userId: socket.auth.userId,
					activity: `Idle`,
				});
			}
		}
	},
	
	setUseMLRecommendations: (use: boolean) => {
		set({ useMLRecommendations: use });
	},
}));

async function playNextWithML() {
	const { mlReferenceSong, mlUsedRecommendations } = usePlayerStore.getState();
	
	if (!mlReferenceSong) {
		return;
	}
	
	try {
		const recommendations = await useMLStore.getState().getRecommendations(
			mlReferenceSong.title, 
			mlReferenceSong.artist, 
			10,
			mlReferenceSong.datasetId
		);
		
		if (recommendations.length > 0) {
			let allSongs = useMusicStore.getState().songs;
			
			if (allSongs.length === 0) {
				await useMusicStore.getState().fetchSongs();
				allSongs = useMusicStore.getState().songs;
			}
			
			for (const recommendedSong of recommendations) {
				if (mlUsedRecommendations.includes(recommendedSong.dataset_id)) {
					continue;
				}
				
				let matchedSong = allSongs.find(song => 
					song.datasetId && song.datasetId === recommendedSong.dataset_id
				);
				
				if (!matchedSong) {
					matchedSong = allSongs.find(song => 
						song.title.toLowerCase().includes(recommendedSong.name.toLowerCase()) ||
						recommendedSong.name.toLowerCase().includes(song.title.toLowerCase())
					);
				}
				
				if (matchedSong) {
					const socket = useChatStore.getState().socket;
					if (socket.auth) {
						socket.emit("update_activity", {
							userId: socket.auth.userId,
							activity: `Playing ${matchedSong.title} by ${matchedSong.artist}`,
						});
					}
					
					usePlayerStore.setState({
						currentSong: matchedSong,
						isPlaying: true,
						mlUsedRecommendations: [...mlUsedRecommendations, recommendedSong.dataset_id],
					});
					
					return;
				}
			}
		}
	} catch (error) {
		console.error("Error getting ML recommendation:", error);
	}
	
	const { currentIndex, queue } = usePlayerStore.getState();
	const nextIndex = currentIndex + 1;
	
	if (nextIndex < queue.length) {
		const nextSong = queue[nextIndex];
		
		const socket = useChatStore.getState().socket;
		if (socket.auth) {
			socket.emit("update_activity", {
				userId: socket.auth.userId,
				activity: `Playing ${nextSong.title} by ${nextSong.artist}`,
			});
		}
		
		usePlayerStore.setState({
			currentSong: nextSong,
			currentIndex: nextIndex,
			isPlaying: true,
		});
	} else {
		usePlayerStore.setState({ isPlaying: false });
		
		const socket = useChatStore.getState().socket;
		if (socket.auth) {
			socket.emit("update_activity", {
				userId: socket.auth.userId,
				activity: `Idle`,
			});
		}
	}
}
