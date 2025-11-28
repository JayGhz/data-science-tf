import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { usePlayerStore } from "@/stores/usePlayerStore";
import { useMLStore } from "@/stores/useMLStore";
import { ListMusic, Mic2, Pause, Play, Repeat, SkipBack, SkipForward, Volume1, TrendingUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const formatTime = (seconds: number) => {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export const PlaybackControls = () => {

	const trendingButtonRef = useRef<HTMLButtonElement | null>(null);
	const [tooltipPosition, setTooltipPosition] = useState<{ top: number; right: number } | null>(null);

	const { currentSong, isPlaying, togglePlay, playNext, playPrevious, useMLRecommendations, setUseMLRecommendations } = usePlayerStore();
	const { currentPrediction, isLoadingPrediction, predictTrending, clearPrediction } = useMLStore();

	const [volume, setVolume] = useState(75);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		audioRef.current = document.querySelector("audio");

		const audio = audioRef.current;
		if (!audio) return;

		const updateTime = () => setCurrentTime(audio.currentTime);
		const updateDuration = () => setDuration(audio.duration);

		audio.addEventListener("timeupdate", updateTime);
		audio.addEventListener("loadedmetadata", updateDuration);

		const handleEnded = () => {
			usePlayerStore.setState({ isPlaying: false });
		};

		audio.addEventListener("ended", handleEnded);

		return () => {
			audio.removeEventListener("timeupdate", updateTime);
			audio.removeEventListener("loadedmetadata", updateDuration);
			audio.removeEventListener("ended", handleEnded);
		};
	}, [currentSong]);

	useEffect(() => {
		if (currentPrediction && !isLoadingPrediction && trendingButtonRef.current) {
			const updatePosition = () => {
				const rect = trendingButtonRef.current?.getBoundingClientRect();
				if (rect) {
					setTooltipPosition({
						top: rect.top - 10,
						right: window.innerWidth - rect.right
					});
				}
			};

			updatePosition();
			window.addEventListener('resize', updatePosition);
			window.addEventListener('scroll', updatePosition);

			return () => {
				window.removeEventListener('resize', updatePosition);
				window.removeEventListener('scroll', updatePosition);
			};
		} else {
			setTooltipPosition(null);
		}
	}, [currentPrediction, isLoadingPrediction]);

	const handleSeek = (value: number[]) => {
		if (audioRef.current) {
			audioRef.current.currentTime = value[0];
		}
	};

	const handleTrendingClick = async () => {
		if (!currentSong) return;

		if (currentPrediction && !isLoadingPrediction) {
			clearPrediction();
			return;
		}

		await predictTrending(currentSong.title, currentSong.artist, currentSong.datasetId);
	};

	return (
		<>
			{tooltipPosition && currentPrediction && !isLoadingPrediction && createPortal(
				<div 
					className="fixed flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 bg-zinc-900 px-5 py-3 rounded-xl border border-zinc-700/50 shadow-2xl backdrop-blur-sm z-[9999]"
					style={{
						top: `${tooltipPosition.top}px`,
						right: `${tooltipPosition.right}px`,
						transform: 'translateY(-100%)',
						marginBottom: '12px'
					}}
				>
					<div className="text-[10px] uppercase tracking-wider text-zinc-100 font-semibold">
						Trending Prediction
					</div>
					<div className="flex items-center gap-3">
						<div className="relative flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden min-w-[120px]">
							<div
								className="absolute inset-0 bg-gradient-to-r from-green-500 via-green-400 to-emerald-400 rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(34,197,94,0.5)]"
								style={{ width: `${Math.round(currentPrediction.probability * 100)}%` }}
							/>
						</div>
						<div className="flex items-baseline gap-0.5 shrink-0 my-1">
							<span className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
								{Math.round(currentPrediction.probability * 100)}
							</span>
							<span className="text-md font-bold text-green-400/80">%</span>
						</div>
					</div>
				</div>,
				document.body
			)}
			<footer className={`player-footer h-20 sm:h-24 bg-zinc-900 border-t border-zinc-800 p-4 mx-2 mb-2 rounded-lg ${useMLRecommendations ? 'ml-recommendations' : ''}`}>
				<div className='player-footer-border'></div>
				<div className='player-footer-content flex justify-between items-center h-full max-w-[1800px] mx-auto'>
				<div className='hidden sm:flex items-center gap-4 min-w-[180px] w-[30%]'>
					{currentSong && (
						<>
							<img
								src={currentSong.imageUrl}
								alt={currentSong.title}
								className='w-14 h-14 object-cover rounded-md'
							/>
							<div className='flex-1 min-w-0'>
								<div className='font-medium truncate hover:underline cursor-pointer'>
									{currentSong.title}
								</div>
								<div className='text-sm text-zinc-400 truncate hover:underline cursor-pointer'>
									{currentSong.artist}
								</div>
							</div>
						</>
					)}
				</div>

				<div className='flex flex-col items-center gap-2 flex-1 max-w-full sm:max-w-[45%]'>
					<div className='flex items-center gap-4 sm:gap-6'>
						<Button
							size='icon'
							variant='ghost'
							className={`hidden sm:inline-flex hover:text-white ${useMLRecommendations ? 'text-green-500' : 'text-zinc-400'}`}
							onClick={() => setUseMLRecommendations(!useMLRecommendations)}
							title={useMLRecommendations ? "Desactivar recomendaciones ML" : "Activar recomendaciones ML"}
						>
							<Sparkles className='h-4 w-4' />
						</Button>

						<Button
							size='icon'
							variant='ghost'
							className='hover:text-white text-zinc-400'
							onClick={playPrevious}
							disabled={!currentSong}
						>
							<SkipBack className='h-4 w-4' />
						</Button>

						<Button
							size='icon'
							className='bg-white hover:bg-white/80 text-black rounded-full h-8 w-8'
							onClick={togglePlay}
							disabled={!currentSong}
						>
							{isPlaying ? <Pause className='h-5 w-5' /> : <Play className='h-5 w-5' />}
						</Button>

						<Button
							size='icon'
							variant='ghost'
							className='hover:text-white text-zinc-400'
							onClick={playNext}
							disabled={!currentSong}
						>
							<SkipForward className='h-4 w-4' />
						</Button>

						<Button
							size='icon'
							variant='ghost'
							className='hidden sm:inline-flex hover:text-white text-zinc-400'
						>
							<Repeat className='h-4 w-4' />
						</Button>
					</div>

					{/* Slider de progreso */}
					<div className='hidden sm:flex items-center gap-2 w-full'>
						<div className='text-xs text-zinc-400'>{formatTime(currentTime)}</div>
						<Slider
							value={[currentTime]}
							max={duration || 100}
							step={1}
							className='w-full hover:cursor-grab active:cursor-grabbing'
							onValueChange={handleSeek}
						/>
						<div className='text-xs text-zinc-400'>{formatTime(duration)}</div>
					</div>
				</div>

				<div className='hidden sm:flex items-center gap-4 min-w-[180px] w-[30%] justify-end'>
					<div className="flex items-center">
						<Button
							ref={trendingButtonRef}
							size="icon"
							variant="ghost"
							className={`${currentPrediction ? "text-zinc-400 hover:text-white" : "text-zinc-400 hover:text-white"} transition-all duration-300`}
							onClick={currentPrediction ? clearPrediction : handleTrendingClick}
							disabled={!currentSong || isLoadingPrediction}
						>
							{isLoadingPrediction ? (
								<div className="h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
							) : (
								<TrendingUp className="h-4 w-4" />
							)}
						</Button>
					</div>

					<Button size='icon' variant='ghost' className='hover:text-white text-zinc-400'>
						<Mic2 className='h-4 w-4' />
					</Button>
					<Button size='icon' variant='ghost' className='hover:text-white text-zinc-400'>
						<ListMusic className='h-4 w-4' />
					</Button>

					<div className='flex items-center gap-2'>
						<Button size='icon' variant='ghost' className='hover:text-white text-zinc-400'>
							<Volume1 className='h-4 w-4' />
						</Button>

						<Slider
							value={[volume]}
							max={100}
							step={1}
							className='w-24 hover:cursor-grab active:cursor-grabbing'
							onValueChange={(value) => {
								setVolume(value[0]);
								if (audioRef.current) {
									audioRef.current.volume = value[0] / 100;
								}
							}}
						/>
					</div>
				</div>
			</div>
		</footer>
		</>
	);
};
