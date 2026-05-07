/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, RefreshCw, ArrowLeft, ExternalLink, Youtube } from 'lucide-react';
import { analyzeMood } from './services/geminiService';
import { MoodAnalysis, Recommendation } from './types/analysis';
import { enrichMusicRecommendations, getRecommendationLinks } from './services/musicMetadataService';

export default function App() {
  const [stage, setStage] = useState<'home' | 'camera' | 'loading' | 'results'>('home');
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MoodAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const enrichmentRunRef = useRef(0);

  const stopCameraStream = useCallback(() => {
    setIsCameraStarting(false);
    setIsCameraReady(false);
    setCameraStream(null);

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoElement(node);
  }, []);

  useEffect(() => {
    if (stage !== 'camera' || !videoElement || !cameraStream) {
      return;
    }

    videoElement.muted = true;
    videoElement.playsInline = true;

    let readinessInterval: number | null = null;
    let readinessTimeout: number | null = null;
    let frameRequestId: number | null = null;

    const markCameraReady = () => {
      const activeTrack = cameraStream.getVideoTracks()[0];
      const hasLiveTrack = Boolean(activeTrack && activeTrack.readyState === 'live');
      const hasFrame =
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const hasUsableMetadata =
        videoElement.readyState >= HTMLMediaElement.HAVE_METADATA &&
        hasLiveTrack;
      const hasAttachedStream = Boolean(videoElement.srcObject);

      if (
        hasFrame ||
        hasUsableMetadata ||
        (hasLiveTrack && hasAttachedStream)
      ) {
        setIsCameraStarting(false);
        setIsCameraReady(true);
      }
    };

    const startPreview = async () => {
      try {
        await videoElement.play();
        markCameraReady();
      } catch (previewError) {
        console.error('Camera preview could not start.', previewError);
        setError('Camera preview could not start. Please retry camera access.');
        stopCameraStream();
        setStage('home');
      }
    };

    const handleReadinessSignal = () => {
      markCameraReady();
    };

    videoElement.addEventListener('loadedmetadata', handleReadinessSignal);
    videoElement.addEventListener('loadeddata', handleReadinessSignal);
    videoElement.addEventListener('canplay', handleReadinessSignal);
    videoElement.addEventListener('playing', handleReadinessSignal);

    videoElement.srcObject = cameraStream;
    void startPreview();

    if ('requestVideoFrameCallback' in videoElement) {
      frameRequestId = videoElement.requestVideoFrameCallback(() => {
        markCameraReady();
      });
    }

    readinessInterval = window.setInterval(() => {
      markCameraReady();
    }, 200);

    readinessTimeout = window.setTimeout(() => {
      markCameraReady();
    }, 1200);

    return () => {
      videoElement.removeEventListener('loadedmetadata', handleReadinessSignal);
      videoElement.removeEventListener('loadeddata', handleReadinessSignal);
      videoElement.removeEventListener('canplay', handleReadinessSignal);
      videoElement.removeEventListener('playing', handleReadinessSignal);

      if (readinessInterval !== null) {
        window.clearInterval(readinessInterval);
      }

      if (readinessTimeout !== null) {
        window.clearTimeout(readinessTimeout);
      }

      if (frameRequestId !== null && 'cancelVideoFrameCallback' in videoElement) {
        videoElement.cancelVideoFrameCallback(frameRequestId);
      }
    };
  }, [stage, videoElement, cameraStream, stopCameraStream]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  const startCamera = async () => {
    const preferredConstraints: MediaStreamConstraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 1280 },
        aspectRatio: { ideal: 3 / 4 },
      },
      audio: false,
    };

    try {
      setError(null);
      stopCameraStream();
      setIsCameraStarting(true);
      setIsCameraReady(false);
      const stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      setStage('camera');
    } catch (cameraError) {
      try {
        setIsCameraStarting(true);
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        cameraStreamRef.current = fallbackStream;
        setCameraStream(fallbackStream);
        setStage('camera');
      } catch (fallbackError) {
        console.error('Camera access failed.', fallbackError);
        setIsCameraStarting(false);
        setError('Camera access is required and the camera could not be connected. Please check browser permission and try again.');
      }
    }
  };

  const processImage = async (dataUrl: string) => {
    setImage(dataUrl);
    setStage('loading');
    setError(null);
    enrichmentRunRef.current += 1;

    try {
      const result = await analyzeMood(dataUrl);
      setAnalysis(result);
      setStage('results');

      const runId = enrichmentRunRef.current;
      void enrichMusicRecommendations(result.recommendations).then((recommendations) => {
        if (enrichmentRunRef.current !== runId) {
          return;
        }

        setAnalysis((current) => (current ? { ...current, recommendations } : current));
      });
    } catch (analysisError: unknown) {
      const message =
        analysisError instanceof Error
          ? analysisError.message
          : 'The AI encountered an error while reading the vibe.';

      setError(message);
      setStage('home');
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    const context = canvasRef.current.getContext('2d');
    if (!context) {
      setError('Could not access the camera frame. Please try again.');
      return;
    }

    const drawCroppedFrame = (
      source: CanvasImageSource,
      sourceWidth: number,
      sourceHeight: number,
    ) => {
      const targetRatio = 3 / 4;
      const sourceRatio = sourceWidth / sourceHeight;

      let cropWidth = sourceWidth;
      let cropHeight = sourceHeight;
      let sourceX = 0;
      let sourceY = 0;

      if (sourceRatio > targetRatio) {
        cropWidth = sourceHeight * targetRatio;
        sourceX = (sourceWidth - cropWidth) / 2;
      } else {
        cropHeight = sourceWidth / targetRatio;
        sourceY = (sourceHeight - cropHeight) / 2;
      }

      canvasRef.current.width = 960;
      canvasRef.current.height = 1280;
      context.save();
      context.translate(canvasRef.current.width, 0);
      context.scale(-1, 1);
      context.drawImage(
        source,
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height,
      );
      context.restore();
    };

    const sourceWidth = videoRef.current.videoWidth;
    const sourceHeight = videoRef.current.videoHeight;

    if (sourceWidth > 0 && sourceHeight > 0 && videoRef.current.readyState >= 2) {
      drawCroppedFrame(videoRef.current, sourceWidth, sourceHeight);
    } else {
      const track = cameraStreamRef.current?.getVideoTracks()[0];
      const ImageCaptureCtor = (window as Window & { ImageCapture?: new (track: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;

      if (!track || !ImageCaptureCtor) {
        setError('Camera preview is not ready yet. Please wait a moment and try again.');
        return;
      }

      try {
        const imageCapture = new ImageCaptureCtor(track);
        const frame = await imageCapture.grabFrame();
        drawCroppedFrame(frame, frame.width, frame.height);
      } catch (captureError) {
        console.error('ImageCapture fallback failed.', captureError);
        setError('Camera frame could not be captured yet. Please wait a moment and try again.');
        return;
      }
    }

    const dataUrl = canvasRef.current.toDataURL('image/jpeg');
    stopCameraStream();
    await processImage(dataUrl);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      processImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    enrichmentRunRef.current += 1;
    stopCameraStream();
    setStage('home');
    setImage(null);
    setAnalysis(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1A1A1A] font-sans selection:bg-[#1A1A1A] selection:text-[#FAF9F6] overflow-x-hidden flex flex-col">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100]"
        style={{ backgroundImage: `url('https://www.transparenttextures.com/patterns/cardboard-flat.png')` }}
      />

      <main className="relative z-10 w-full max-w-7xl mx-auto flex-1 flex flex-col">
        <motion.nav
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-center px-6 md:px-12 py-8 border-b border-[#1A1A1A]/10 w-full"
        >
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <span className="font-serif text-3xl font-bold tracking-tighter">MoodTune</span>
          </div>
          <div className="hidden md:flex gap-10 text-[10px] uppercase tracking-[0.3em] font-semibold opacity-60">
            <button onClick={reset} className="hover:opacity-100 transition-opacity">Capture</button>
            <button className="hover:opacity-100 transition-opacity">Gallery</button>
            <button className="hover:opacity-100 transition-opacity">Analysis</button>
          </div>
          {stage !== 'home' && (
            <button
              onClick={reset}
              className="p-2 rounded-full border border-[#1A1A1A]/10 hover:bg-black/5 transition-colors group"
            >
              <ArrowLeft className="w-5 h-5 opacity-60 group-hover:opacity-100" />
            </button>
          )}
        </motion.nav>

        <AnimatePresence mode="wait">
          {stage === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col md:flex-row"
            >
              <section className="md:w-[45%] p-8 md:p-16 flex flex-col justify-center border-b md:border-b-0 md:border-r border-[#1A1A1A]/10">
                <div className="space-y-8">
                  <h1 className="font-serif text-6xl md:text-8xl leading-[0.9] tracking-tighter">
                    Capture
                    <br />
                    <span className="italic font-normal">the vibe.</span>
                  </h1>
                  <p className="text-sm text-gray-500 max-w-xs leading-relaxed font-light">
                    Our neural engine translates the visual language of your photos into a curated sensory experience of sound, literature, and cinema.
                  </p>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-red-600 text-xs font-medium"
                    >
                      {error}
                    </motion.div>
                  )}
                </div>
              </section>

              <section className="flex-1 p-8 md:p-16 flex flex-col items-center justify-center bg-white">
                <div
                  className="w-full max-w-md aspect-[4/3] md:aspect-square border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center gap-6 group cursor-pointer hover:border-black transition-all duration-500 hover:bg-[#FAF9F6]"
                  onClick={startCamera}
                >
                  <div className="w-16 h-16 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center group-hover:bg-[#1A1A1A] transition-colors duration-500">
                    <Camera className="w-6 h-6 text-[#1A1A1A] group-hover:text-white" />
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold tracking-widest uppercase block mb-2">Initialize Vision</span>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Capture or Upload</p>
                  </div>
                </div>

                <div className="mt-12 flex flex-col items-center gap-6 w-full max-w-md">
                  <div className="w-full flex items-center gap-4">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-[9px] uppercase tracking-[0.3em] text-gray-300 font-bold">Options</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>

                  <div className="flex gap-4 w-full">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 h-14 rounded-full border border-gray-200 hover:border-black font-bold text-[10px] uppercase tracking-widest transition-all"
                    >
                      Upload Archive
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      accept="image/*"
                    />
                  </div>
                </div>
              </section>
            </motion.div>
          )}

          {stage === 'camera' && (
            <motion.div
              key="camera"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 p-8 md:p-16 flex items-center justify-center"
            >
              <div className="w-full max-w-md md:max-w-lg aspect-[3/4] rounded-[2.5rem] overflow-hidden relative border border-[#1A1A1A]/10 bg-black/5 shadow-2xl">
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute top-6 left-6 glass px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-[0.3em]">
                  {isCameraReady ? 'Live Camera Preview' : 'Connecting Camera'}
                </div>
                {!isCameraReady && (
                  <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px] flex items-center justify-center">
                    <div className="glass px-5 py-3 rounded-full text-[10px] font-bold uppercase tracking-[0.3em]">
                      {isCameraStarting ? 'Waiting For Camera' : 'Preparing Preview'}
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-12 flex justify-center items-center">
                  <button
                    onClick={capturePhoto}
                    className="w-24 h-24 rounded-full border-2 border-white/40 flex items-center justify-center p-2 group bg-white/10 backdrop-blur-md"
                  >
                    <div className="w-full h-full rounded-full bg-white group-hover:scale-110 transition-transform" />
                  </button>
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </motion.div>
          )}

          {stage === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center py-24 space-y-12"
            >
              <div className="relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                  className="w-32 h-32 rounded-full border border-gray-100 border-t-black"
                />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                  <div className="w-1 h-1 bg-black rounded-full animate-ping" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h3 className="font-serif text-3xl italic">Reading the nuance...</h3>
                <p className="text-[9px] uppercase tracking-[0.4em] font-bold text-gray-400">VisionML Engine 4.0 Active</p>
              </div>
            </motion.div>
          )}

          {stage === 'results' && analysis && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col md:flex-row overflow-hidden"
            >
              <section className="md:w-[40%] p-8 md:p-12 border-b md:border-b-0 md:border-r border-[#1A1A1A]/10 flex flex-col">
                <div className="flex-1 space-y-10">
                  <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-gray-100 aspect-[4/5] md:aspect-auto md:flex-1">
                    <img src={image!} alt="Captured" className="w-full h-full object-cover" />
                    <div className="absolute top-6 left-6 flex flex-wrap gap-2">
                      <span className="glass px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest shadow-sm">
                        Detected: {analysis.mood}
                      </span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-6 glass flex justify-between items-end">
                      <div className="flex gap-1.5">
                        {analysis.colors.slice(0, 3).map((_, index) => (
                          <div key={index} className="w-3 h-3 rounded-full bg-black/20" />
                        ))}
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] uppercase font-bold opacity-40">Analysis Source</p>
                        <p className="font-serif text-lg leading-none">{analysis.sourceLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h2 className="font-serif text-5xl leading-none tracking-tighter">
                      {analysis.mood}
                    </h2>
                    <p className="text-sm text-gray-500 italic font-serif leading-relaxed pr-8">
                      &ldquo;{analysis.vibe}&rdquo;
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {analysis.colors.map((color, index) => (
                        <span key={index} className="mood-tag px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest text-black/60">
                          {color}
                        </span>
                      ))}
                    </div>
                    {analysis.warning && (
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-700">
                        {analysis.warning}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex-1 p-8 md:p-12 bg-white flex flex-col">
                <div className="flex-1 space-y-12">
                  <header className="flex justify-between items-end pb-4 border-b border-gray-100">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-1">Selections</h3>
                      <p className="text-[10px] text-gray-400 font-medium">Curated for your specific visual resonance</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div
                        className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                        onClick={reset}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </div>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <EditorialGroup
                      title="Soundtrack"
                      items={analysis.recommendations.filter((item) => item.type === 'song')}
                    />
                    <EditorialGroup
                      title="Literature"
                      items={analysis.recommendations.filter((item) => item.type === 'book')}
                    />
                    <EditorialGroup
                      title="Cinema"
                      items={analysis.recommendations.filter((item) => item.type === 'movie')}
                    />
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="px-6 md:px-12 py-8 border-t border-[#1A1A1A]/10 flex flex-col md:row justify-between items-center gap-4 text-[9px] uppercase tracking-[0.2em] font-semibold text-gray-400">
          <div className="flex gap-6">
            <span className="mood-tag px-4 py-1.5 rounded-full cursor-default">Cinematic</span>
            <span className="mood-tag px-4 py-1.5 rounded-full cursor-default">Neural Engine</span>
            <span className="mood-tag px-4 py-1.5 rounded-full cursor-default">Design v2.0</span>
          </div>
          <div className="italic opacity-60">
            MoodTune Studio &copy; 2026 - Sensory Translation Module
          </div>
        </footer>
      </main>
    </div>
  );
}

function EditorialGroup({ title, items }: { title: string; items: Recommendation[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{title}</h3>
        <span className="text-[10px] font-serif italic text-gray-400">Curated Match</span>
      </div>

      <div className="space-y-4">
        {items.map((item, index) =>
          <React.Fragment key={index}>
            {item.type === 'song'
              ? <SongCard item={item} />
              : <RecommendationCard item={item} />}
          </React.Fragment>,
        )}
      </div>
    </motion.div>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <div className="group p-4 border border-[#1A1A1A]/5 rounded-xl flex items-center gap-4 hover:border-black/20 transition-all duration-300 bg-[#FAF9F6]/50">
      <div className="w-12 h-12 bg-black flex-shrink-0 rounded-lg flex items-center justify-center">
        <span className="text-[8px] text-white/40 uppercase font-bold tracking-tighter">Mood</span>
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-xs font-bold truncate tracking-tight">{item.title}</h4>
        <p className="text-[9px] uppercase tracking-widest text-gray-500 truncate mt-0.5">{item.creator}</p>
        <p className="text-[10px] text-gray-400 leading-tight mt-2 line-clamp-2 font-light">{item.description}</p>
      </div>
    </div>
  );
}

function SongCard({ item }: { item: Recommendation }) {
  const links = getRecommendationLinks(item);
  const primaryHref = links.primary === 'youtube' ? links.youtube : links.spotify;

  const openPrimary = () => {
    if (primaryHref) {
      window.open(primaryHref, '_blank', 'noopener,noreferrer');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPrimary();
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openPrimary}
      onKeyDown={handleKeyDown}
      className="group p-4 border border-[#1A1A1A]/5 rounded-xl flex items-start gap-4 hover:border-black/20 transition-all duration-300 bg-[#FAF9F6]/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-black/10"
    >
      <div className="w-14 h-14 bg-black/95 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center">
        {item.preview?.artworkUrl ? (
          <img
            src={item.preview.artworkUrl}
            alt={`${item.title} cover art`}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <MediaBadge />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-xs font-bold truncate tracking-tight">{item.title}</h4>
            <p className="text-[9px] uppercase tracking-widest text-gray-500 truncate mt-0.5">{item.creator}</p>
            {item.preview?.albumTitle && (
              <p className="text-[10px] text-gray-400 truncate mt-1 italic">
                {item.preview.albumTitle}
              </p>
            )}
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-black/30 flex-shrink-0 mt-0.5 group-hover:text-black/60 transition-colors" />
        </div>

        <p className="text-[10px] text-gray-400 leading-tight mt-2 line-clamp-2 font-light">{item.description}</p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {links.spotify && (
            <MediaLink
              href={links.spotify}
              label="Open in Spotify"
              onClick={(event) => event.stopPropagation()}
            >
              <SpotifyIcon className="w-3.5 h-3.5" />
              <span>Spotify</span>
            </MediaLink>
          )}
          {links.youtube && (
            <MediaLink
              href={links.youtube}
              label="Open in YouTube"
              onClick={(event) => event.stopPropagation()}
            >
              <Youtube className="w-3.5 h-3.5" />
              <span>YouTube</span>
            </MediaLink>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaLink({
  href,
  label,
  children,
  onClick,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#1A1A1A]/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/70 transition-colors hover:border-black hover:text-black"
    >
      {children}
    </a>
  );
}

function MediaBadge() {
  return (
    <div className="flex items-center gap-1.5">
      <SpotifyIcon className="w-3.5 h-3.5 text-white" />
      <Youtube className="w-3.5 h-3.5 text-white" />
    </div>
  );
}

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M7.4 9.2C10.8 8 14.4 8.2 17.3 9.8" stroke="#FAF9F6" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 12C10.7 11.1 13.5 11.2 15.8 12.4" stroke="#FAF9F6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.7 14.5C10.5 13.9 12.4 13.9 14 14.7" stroke="#FAF9F6" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
