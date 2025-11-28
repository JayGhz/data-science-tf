import axios from "axios";

// Axios instance para el backend principal
export const axiosInstance = axios.create({
	baseURL: import.meta.env.MODE === "development" ? "http://localhost:5000/api" : "/api",
});

// Axios instance para el ML backend
export const mlAxiosInstance = axios.create({
	baseURL: import.meta.env.MODE === "development" ? "http://localhost:5001" : "/ml-api",
});
