import { mlAxiosInstance } from "@/lib/axios";
import { SongRecommendation, TrendingPrediction } from "@/types";
import { create } from "zustand";

interface MLStore {
	currentPrediction: TrendingPrediction | null;
	isLoadingPrediction: boolean;
	recommendations: SongRecommendation[];
	isLoadingRecommendations: boolean;
	
	predictTrending: (title: string, artist: string, datasetId?: string) => Promise<TrendingPrediction | null>;
	getRecommendations: (title: string, artist: string, k?: number, datasetId?: string) => Promise<SongRecommendation[]>;
	clearPrediction: () => void;
}

export const useMLStore = create<MLStore>((set) => ({
	currentPrediction: null,
	isLoadingPrediction: false,
	recommendations: [],
	isLoadingRecommendations: false,

	predictTrending: async (title: string, artist: string, datasetId?: string) => {
		set({ isLoadingPrediction: true });
		try {
			const response = await mlAxiosInstance.post<TrendingPrediction>("/predict-trending", {
				title,
				artist,
				datasetId,
			});
			set({ currentPrediction: response.data, isLoadingPrediction: false });
			return response.data;
		} catch (error) {
			console.error("Error predicting trending:", error);
			set({ 
				currentPrediction: null, 
				isLoadingPrediction: false 
			});
			return null;
		}
	},

	getRecommendations: async (title: string, artist: string, k = 5, datasetId?: string) => {
		set({ isLoadingRecommendations: true });
		try {
			const response = await mlAxiosInstance.post<{
				query: { title: string; artist: string; dataset_id: string };
				recommendations: SongRecommendation[];
			}>("/recommend", {
				title,
				artist,
				k,
				datasetId,
			});
			set({ 
				recommendations: response.data.recommendations, 
				isLoadingRecommendations: false 
			});
			return response.data.recommendations;
		} catch (error) {
			console.error("Error getting recommendations:", error);
			set({ recommendations: [], isLoadingRecommendations: false });
			return [];
		}
	},

	clearPrediction: () => {
		set({ currentPrediction: null });
	},
}));
