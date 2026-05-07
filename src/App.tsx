/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, RefreshCw, ArrowLeft, ExternalLink, Pause, Play, Youtube, BookmarkPlus, History, Sparkles, Frame, SlidersHorizontal, Share2, Copy } from 'lucide-react';
import { analyzeMood } from './services/geminiService';
import { MoodAnalysis, Recommendation } from './types/analysis';
import { enrichMusicRecommendations, getRecommendationLinks } from './services/musicMetadataService';

type AppStage = 'home' | 'camera' | 'editor' | 'loading' | 'results';
type AspectRatioOption = '3:4' | '16:9';
type EditorFilter = 'none' | 'warm' | 'mono' | 'dreamy';
type EditorSticker = 'none' | 'hearts' | 'sparkles' | 'blush' | 'pixel';
type EditorFrame = 'none' | 'postcard' | 'cinema';
type StickerAnchor = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  tracked: boolean;
};

type FaceDetectionLike = {
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type FaceDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect: (input: ImageBitmapSource) => Promise<FaceDetectionLike[]>;
};

type HistoryEntry = {
  id: string;
  image: string;
  analysis: MoodAnalysis;
  createdAt: string;
  aspectRatio: AspectRatioOption;
};

const HISTORY_STORAGE_KEY = 'moodtune-history-v1';
const HISTORY_LIMIT = 5;

const ASPECT_RATIO_DIMENSIONS: Record<AspectRatioOption, { width: number; height: number }> = {
  '3:4': { width: 960, height: 1280 },
  '16:9': { width: 1280, height: 720 },
};

function getAspectRatioValue(aspectRatio: AspectRatioOption) {
  return aspectRatio === '3:4' ? 3 / 4 : 16 / 9;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getDefaultStickerAnchor(): StickerAnchor {
  return {
    centerX: 0.5,
    centerY: 0.38,
    width: 0.26,
    height: 0.26,
    tracked: false,
  };
}

function mapStickerAnchorToCroppedOutput({
  anchor,
  sourceWidth,
  sourceHeight,
  sourceX,
  sourceY,
  cropWidth,
  cropHeight,
}: {
  anchor?: StickerAnchor | null;
  sourceWidth: number;
  sourceHeight: number;
  sourceX: number;
  sourceY: number;
  cropWidth: number;
  cropHeight: number;
}) {
  const base = anchor ?? getDefaultStickerAnchor();
  const anchorCenterX = base.centerX * sourceWidth;
  const anchorCenterY = base.centerY * sourceHeight;
  const anchorWidth = base.width * sourceWidth;
  const anchorHeight = base.height * sourceHeight;

  return {
    centerX: clamp01((anchorCenterX - sourceX) / cropWidth),
    centerY: clamp01((anchorCenterY - sourceY) / cropHeight),
    width: clamp01(anchorWidth / cropWidth),
    height: clamp01(anchorHeight / cropHeight),
    tracked: base.tracked,
  };
}

function getFaceDetectorCtor() {
  return (window as Window & { FaceDetector?: FaceDetectorCtor }).FaceDetector;
}

function getEditorFilterValue(filter: EditorFilter) {
  switch (filter) {
    case 'warm':
      return 'saturate(1.08) contrast(1.04) sepia(0.16) hue-rotate(-6deg)';
    case 'mono':
      return 'grayscale(1) contrast(1.08) brightness(1.02)';
    case 'dreamy':
      return 'saturate(1.12) brightness(1.05) contrast(0.96)';
    default:
      return 'none';
  }
}

function buildInstagramCaption(analysis: MoodAnalysis) {
  const songs = analysis.recommendations
    .filter((item) => item.type === 'song')
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.title} - ${item.creator}`);

  const colorsLine = analysis.colors.slice(0, 4).join(' / ');
  const songSection = songs.length > 0 ? songs.join('\n') : 'No soundtrack recommendations available.';

  return [
    `${analysis.mood} energy.`,
    '',
    analysis.vibe,
    '',
    `Palette: ${colorsLine}`,
    '',
    '5 songs that match this mood:',
    songSection,
    '',
    '#MoodTune #VisualVibe #SoundtrackMatch #GeminiVision',
  ].join('\n');
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

function triggerFileDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildInstagramShareCard({
  imageSource,
  analysis,
}: {
  imageSource: string;
  analysis: MoodAnalysis;
}) {
  const image = await loadImageElement(imageSource);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is unavailable for Instagram share export.');
  }

  const width = 1080;
  const height = 1920;
  canvas.width = width;
  canvas.height = height;
  await document.fonts?.ready;

  const backgroundGradient = context.createLinearGradient(0, 0, width, height);
  backgroundGradient.addColorStop(0, '#fbf8f1');
  backgroundGradient.addColorStop(0.5, '#f1eadf');
  backgroundGradient.addColorStop(1, '#e6dac9');
  context.fillStyle = backgroundGradient;
  context.fillRect(0, 0, width, height);

  context.save();
  const softLight = context.createRadialGradient(150, 90, 20, 150, 90, 440);
  softLight.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  softLight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = softLight;
  context.fillRect(0, 0, width, height);

  const champagneLight = context.createRadialGradient(930, 240, 30, 930, 240, 420);
  champagneLight.addColorStop(0, 'rgba(225, 198, 151, 0.34)');
  champagneLight.addColorStop(1, 'rgba(225, 198, 151, 0)');
  context.fillStyle = champagneLight;
  context.fillRect(0, 0, width, height);
  context.restore();

  context.save();
  context.globalAlpha = 0.22;
  context.strokeStyle = 'rgba(255,255,255,0.65)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(74, 144);
  context.bezierCurveTo(280, 44, 800, 38, 1010, 200);
  context.stroke();
  context.beginPath();
  context.moveTo(60, 1700);
  context.bezierCurveTo(320, 1610, 740, 1600, 1020, 1760);
  context.stroke();
  context.restore();

  const photoX = 86;
  const photoY = 96;
  const photoWidth = width - photoX * 2;
  const photoHeight = 670;
  const imageRatio = image.width / image.height;
  const targetRatio = photoWidth / photoHeight;

  let cropWidth = image.width;
  let cropHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > targetRatio) {
    cropWidth = image.height * targetRatio;
    sourceX = (image.width - cropWidth) / 2;
  } else {
    cropHeight = image.width / targetRatio;
    sourceY = (image.height - cropHeight) / 2;
  }

  const radius = 44;
  context.save();
  context.fillStyle = 'rgba(255,255,255,0.92)';
  context.shadowColor = 'rgba(50, 34, 15, 0.14)';
  context.shadowBlur = 40;
  context.shadowOffsetY = 18;
  roundRect(context, photoX - 10, photoY - 10, photoWidth + 20, photoHeight + 20, radius + 14);
  context.fill();
  context.restore();

  context.save();
  roundRect(context, photoX, photoY, photoWidth, photoHeight, radius);
  context.clip();
  context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, photoX, photoY, photoWidth, photoHeight);

  const photoGlare = context.createLinearGradient(photoX, photoY, photoX + photoWidth * 0.72, photoY + photoHeight * 0.62);
  photoGlare.addColorStop(0, 'rgba(255,255,255,0.34)');
  photoGlare.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  photoGlare.addColorStop(0.55, 'rgba(255,255,255,0.02)');
  photoGlare.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = photoGlare;
  context.beginPath();
  context.moveTo(photoX + 70, photoY + 26);
  context.lineTo(photoX + photoWidth * 0.62, photoY + 26);
  context.lineTo(photoX + photoWidth * 0.34, photoY + photoHeight - 40);
  context.lineTo(photoX + 10, photoY + photoHeight - 40);
  context.closePath();
  context.fill();
  context.restore();

  context.save();
  context.fillStyle = 'rgba(255,255,255,0.88)';
  roundRect(context, 118, 132, 292, 54, 27);
  context.fill();
  context.restore();
  context.fillStyle = '#1a1a1a';
  context.font = '700 19px "Inter", sans-serif';
  context.fillText('MOODTUNE CURATION', 144, 167);

  context.fillStyle = '#1a1a1a';
  context.font = '700 82px "Playfair Display", Georgia, serif';
  context.fillText(fitText(context, analysis.mood, 880), 90, 852);

  context.fillStyle = 'rgba(26, 26, 26, 0.72)';
  context.font = '500 27px "Inter", Arial, sans-serif';
  const vibeLines = wrapText(context, `"${analysis.vibe}"`, 890);
  vibeLines.slice(0, 4).forEach((line, index) => {
    context.fillText(line, 94, 924 + index * 38);
  });

  const panelX = 76;
  const panelY = 1126;
  const panelWidth = 928;
  const panelHeight = 682;

  context.save();
  context.fillStyle = 'rgba(255,255,255,0.95)';
  context.shadowColor = 'rgba(26, 26, 26, 0.09)';
  context.shadowBlur = 26;
  context.shadowOffsetY = 12;
  roundRect(context, panelX, panelY, panelWidth, panelHeight, 42);
  context.fill();
  context.restore();

  context.save();
  roundRect(context, panelX, panelY, panelWidth, panelHeight, 42);
  context.clip();
  const panelGlare = context.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + 480);
  panelGlare.addColorStop(0, 'rgba(255,255,255,0.55)');
  panelGlare.addColorStop(0.26, 'rgba(255,255,255,0.18)');
  panelGlare.addColorStop(0.42, 'rgba(255,255,255,0.05)');
  panelGlare.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = panelGlare;
  context.beginPath();
  context.moveTo(panelX, panelY);
  context.lineTo(panelX + 486, panelY);
  context.lineTo(panelX + 278, panelY + panelHeight);
  context.lineTo(panelX, panelY + panelHeight);
  context.closePath();
  context.fill();
  context.restore();

  context.fillStyle = 'rgba(26, 26, 26, 0.42)';
  context.font = '700 17px "Inter", Arial, sans-serif';
  context.fillText('PALETTE', 116, 1190);
  context.fillText('SOUNDTRACK', 116, 1320);
  context.fillStyle = 'rgba(26, 26, 26, 0.34)';
  context.font = '600 14px "Outfit", Arial, sans-serif';
  context.fillText('5 TRACKS FOR THIS FRAME', 690, 1320);

  analysis.colors.slice(0, 4).forEach((color, index) => {
    const pillX = 116 + index * 212;
    context.fillStyle = 'rgba(26, 26, 26, 0.055)';
    roundRect(context, pillX, 1218, 188, 52, 26);
    context.fill();
    context.fillStyle = 'rgba(26, 26, 26, 0.76)';
    context.font = '600 18px "Inter", Arial, sans-serif';
    context.fillText(fitText(context, color.toUpperCase(), 150), pillX + 18, 1252);
  });

  const songs = analysis.recommendations.filter((item) => item.type === 'song').slice(0, 5);
  songs.forEach((song, index) => {
    const rowTop = 1368 + index * 84;
    const rowCenterY = rowTop + 34;

    context.fillStyle = index % 2 === 0 ? 'rgba(26, 26, 26, 0.045)' : 'rgba(255, 255, 255, 0.54)';
    roundRect(context, 108, rowTop, 864, 68, 24);
    context.fill();

    context.save();
    const badgeGradient = context.createLinearGradient(0, rowTop, 0, rowTop + 46);
    badgeGradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    badgeGradient.addColorStop(1, 'rgba(26, 26, 26, 0.07)');
    context.fillStyle = badgeGradient;
    context.beginPath();
    context.arc(142, rowCenterY, 20, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.fillStyle = '#1a1a1a';
    context.font = '700 16px "Inter", Arial, sans-serif';
    context.fillText(String(index + 1), 137, rowCenterY + 6);

    context.fillStyle = '#1a1a1a';
    context.font = '700 22px "Inter", Arial, sans-serif';
    context.fillText(fitText(context, song.title, 690), 184, rowTop + 26);
    context.fillStyle = 'rgba(26, 26, 26, 0.58)';
    context.font = '500 19px "Inter", Arial, sans-serif';
    context.fillText(fitText(context, song.creator, 690), 184, rowTop + 54);
  });

  context.fillStyle = 'rgba(26, 26, 26, 0.24)';
  context.fillRect(116, 1346, 848, 1);

  context.fillStyle = 'rgba(26, 26, 26, 0.72)';
  context.font = '700 20px "Inter", Arial, sans-serif';
  context.fillText(analysis.sourceLabel.toUpperCase(), 116, 1834);

  context.fillStyle = 'rgba(26, 26, 26, 0.42)';
  context.font = '600 21px "Inter", Arial, sans-serif';
  context.fillText('Made With MoodTune v1.0', 116, 1868);

  context.save();
  context.fillStyle = 'rgba(26, 26, 26, 0.08)';
  context.beginPath();
  context.arc(930, 1838, 54, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(255,255,255,0.55)';
  context.beginPath();
  context.arc(930, 1838, 28, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(26, 26, 26, 0.12)';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(930, 1838, 42, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(26, 26, 26, 0.08)';
  context.lineWidth = 2;
  roundRect(context, 48, 48, width - 96, height - 96, 34);
  context.stroke();
  context.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Instagram share image could not be exported.'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let start = 0;
  let end = text.length;
  let result = '';

  while (start <= end) {
    const midpoint = Math.floor((start + end) / 2);
    const candidate = `${text.slice(0, midpoint).trimEnd()}...`;

    if (context.measureText(candidate).width <= maxWidth) {
      result = candidate;
      start = midpoint + 1;
    } else {
      end = midpoint - 1;
    }
  }

  return result;
}

function loadImageElement(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image data could not be loaded for editing.'));
    image.src = source;
  });
}

function drawHeart(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  fillStyle: string,
  strokeStyle = 'rgba(255,255,255,0.92)',
) {
  const topCurveHeight = size * 0.32;
  context.save();
  context.beginPath();
  context.moveTo(centerX, centerY + topCurveHeight);
  context.bezierCurveTo(
    centerX,
    centerY,
    centerX - size / 2,
    centerY,
    centerX - size / 2,
    centerY + topCurveHeight,
  );
  context.bezierCurveTo(
    centerX - size / 2,
    centerY + (size + topCurveHeight) / 2,
    centerX,
    centerY + (size + topCurveHeight) / 2,
    centerX,
    centerY + size,
  );
  context.bezierCurveTo(
    centerX,
    centerY + (size + topCurveHeight) / 2,
    centerX + size / 2,
    centerY + (size + topCurveHeight) / 2,
    centerX + size / 2,
    centerY + topCurveHeight,
  );
  context.bezierCurveTo(
    centerX + size / 2,
    centerY,
    centerX,
    centerY,
    centerX,
    centerY + topCurveHeight,
  );
  context.closePath();
  context.fillStyle = fillStyle;
  context.shadowColor = 'rgba(255, 77, 136, 0.22)';
  context.shadowBlur = size * 0.18;
  context.lineWidth = Math.max(2, size * 0.08);
  context.strokeStyle = strokeStyle;
  context.stroke();
  context.fill();
  context.restore();
}

function drawSparkle(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  fillStyle: string,
) {
  context.save();
  context.translate(centerX, centerY);
  context.rotate(Math.PI / 4);
  context.fillStyle = fillStyle;
  context.shadowColor = 'rgba(255,255,255,0.35)';
  context.shadowBlur = size * 0.2;
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.24, -size * 0.24);
  context.lineTo(size, 0);
  context.lineTo(size * 0.24, size * 0.24);
  context.lineTo(0, size);
  context.lineTo(-size * 0.24, size * 0.24);
  context.lineTo(-size, 0);
  context.lineTo(-size * 0.24, -size * 0.24);
  context.closePath();
  context.fill();
  context.restore();
}

function drawPixelHeart(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  pixelSize: number,
  fillStyle: string,
) {
  const pattern = [
    [0, 1, 1, 0, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 0, 0],
    [0, 0, 0, 1, 0, 0, 0],
  ];

  context.save();
  context.fillStyle = fillStyle;
  context.shadowColor = 'rgba(255,255,255,0.18)';
  context.shadowBlur = pixelSize * 0.4;
  pattern.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      context.fillRect(startX + colIndex * pixelSize, startY + rowIndex * pixelSize, pixelSize, pixelSize);
    });
  });
  context.restore();
}

function drawStickerOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  sticker: EditorSticker,
  anchor?: StickerAnchor | null,
) {
  if (sticker === 'none') {
    return;
  }

  const resolvedAnchor = anchor ?? getDefaultStickerAnchor();
  const faceCenterX = resolvedAnchor.centerX * width;
  const faceCenterY = resolvedAnchor.centerY * height;
  const faceWidth = Math.max(width * 0.16, resolvedAnchor.width * width);
  const faceHeight = Math.max(height * 0.16, resolvedAnchor.height * height);
  const headTopY = faceCenterY - faceHeight * 0.72;
  const topLeftX = faceCenterX - faceWidth * 0.9;
  const topRightX = faceCenterX + faceWidth * 0.72;
  const sizeBase = Math.min(faceWidth, faceHeight);

  if (sticker === 'hearts') {
    [
      { x: topLeftX - faceWidth * 0.12, y: headTopY + faceHeight * 0.02, size: sizeBase * 0.44, color: 'rgba(255, 116, 156, 0.98)' },
      { x: topLeftX + faceWidth * 0.18, y: headTopY - faceHeight * 0.14, size: sizeBase * 0.26, color: 'rgba(255, 182, 206, 0.96)' },
      { x: faceCenterX - faceWidth * 0.08, y: headTopY - faceHeight * 0.22, size: sizeBase * 0.19, color: 'rgba(255, 203, 220, 0.96)' },
      { x: topRightX, y: headTopY + faceHeight * 0.07, size: sizeBase * 0.4, color: 'rgba(255, 116, 156, 0.98)' },
      { x: topRightX + faceWidth * 0.26, y: headTopY - faceHeight * 0.1, size: sizeBase * 0.24, color: 'rgba(255, 188, 214, 0.96)' },
      { x: faceCenterX + faceWidth * 0.24, y: headTopY - faceHeight * 0.28, size: sizeBase * 0.18, color: 'rgba(255, 159, 194, 0.94)' },
    ].forEach((item) => {
      drawHeart(context, item.x, item.y, item.size, item.color);
    });

    context.save();
    context.fillStyle = 'rgba(255,255,255,0.92)';
    [
      { x: faceCenterX - faceWidth * 0.42, y: headTopY + faceHeight * 0.18, radius: sizeBase * 0.035 },
      { x: faceCenterX + faceWidth * 0.5, y: headTopY + faceHeight * 0.08, radius: sizeBase * 0.03 },
      { x: faceCenterX + faceWidth * 0.08, y: headTopY - faceHeight * 0.02, radius: sizeBase * 0.024 },
    ].forEach((dot) => {
      context.beginPath();
      context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  if (sticker === 'sparkles') {
    [
      { x: faceCenterX - faceWidth * 0.82, y: headTopY + faceHeight * 0.08, size: sizeBase * 0.22, color: 'rgba(255, 224, 145, 0.98)' },
      { x: faceCenterX - faceWidth * 0.34, y: headTopY - faceHeight * 0.2, size: sizeBase * 0.16, color: 'rgba(255, 244, 205, 0.96)' },
      { x: faceCenterX + faceWidth * 0.06, y: headTopY - faceHeight * 0.28, size: sizeBase * 0.2, color: 'rgba(255, 231, 160, 0.98)' },
      { x: faceCenterX + faceWidth * 0.55, y: headTopY - faceHeight * 0.08, size: sizeBase * 0.15, color: 'rgba(255, 247, 219, 0.96)' },
      { x: faceCenterX + faceWidth * 0.9, y: headTopY + faceHeight * 0.12, size: sizeBase * 0.24, color: 'rgba(255, 221, 136, 0.98)' },
    ].forEach((sparkle) => {
      drawSparkle(context, sparkle.x, sparkle.y, sparkle.size, sparkle.color);
    });
  }

  if (sticker === 'blush') {
    context.save();
    context.fillStyle = 'rgba(255, 133, 173, 0.34)';
    context.filter = `blur(${Math.max(10, sizeBase * 0.18)}px)`;
    context.beginPath();
    context.ellipse(faceCenterX - faceWidth * 0.34, faceCenterY + faceHeight * 0.14, faceWidth * 0.2, faceHeight * 0.1, -0.12, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(faceCenterX + faceWidth * 0.34, faceCenterY + faceHeight * 0.14, faceWidth * 0.2, faceHeight * 0.1, 0.12, 0, Math.PI * 2);
    context.fill();
    context.restore();

    drawHeart(context, faceCenterX - faceWidth * 0.52, headTopY + faceHeight * 0.14, sizeBase * 0.16, 'rgba(255, 175, 202, 0.95)');
    drawHeart(context, faceCenterX + faceWidth * 0.52, headTopY + faceHeight * 0.18, sizeBase * 0.16, 'rgba(255, 175, 202, 0.95)');
  }

  if (sticker === 'pixel') {
    drawPixelHeart(context, faceCenterX - faceWidth * 0.95, headTopY + faceHeight * 0.08, Math.max(4, sizeBase * 0.055), '#ff6f9d');
    drawPixelHeart(context, faceCenterX + faceWidth * 0.55, headTopY - faceHeight * 0.06, Math.max(4, sizeBase * 0.048), '#ff9fc0');
    drawSparkle(context, faceCenterX - faceWidth * 0.05, headTopY - faceHeight * 0.24, sizeBase * 0.13, 'rgba(160, 239, 255, 0.95)');
    drawSparkle(context, faceCenterX + faceWidth * 0.46, headTopY + faceHeight * 0.02, sizeBase * 0.1, 'rgba(255, 240, 170, 0.95)');
  }
}

function drawFrameOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: EditorFrame,
) {
  context.save();

  if (frame === 'postcard') {
    const border = Math.round(Math.min(width, height) * 0.04);
    context.fillStyle = '#f7f2ea';
    context.fillRect(0, 0, width, border);
    context.fillRect(0, 0, border, height);
    context.fillRect(width - border, 0, border, height);
    context.fillRect(0, height - border * 1.7, width, border * 1.7);
  }

  if (frame === 'cinema') {
    const matte = Math.round(height * 0.1);
    context.fillStyle = 'rgba(10, 10, 10, 0.94)';
    context.fillRect(0, 0, width, matte);
    context.fillRect(0, height - matte, width, matte);
    context.strokeStyle = 'rgba(255,255,255,0.18)';
    context.lineWidth = 2;
    context.strokeRect(20, 20, width - 40, height - 40);
  }

  context.restore();
}

function drawStyledImageToCanvas({
  context,
  targetCanvas,
  source,
  sourceWidth,
  sourceHeight,
  aspectRatio,
  filter,
  frame,
  sticker,
  stickerAnchor,
  mirror = false,
}: {
  context: CanvasRenderingContext2D;
  targetCanvas: HTMLCanvasElement;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  aspectRatio: AspectRatioOption;
  filter: EditorFilter;
  frame: EditorFrame;
  sticker: EditorSticker;
  stickerAnchor?: StickerAnchor | null;
  mirror?: boolean;
}) {
  const { width, height } = ASPECT_RATIO_DIMENSIONS[aspectRatio];
  const targetRatio = getAspectRatioValue(aspectRatio);
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

  const mappedStickerAnchor = mapStickerAnchorToCroppedOutput({
    anchor: stickerAnchor,
    sourceWidth,
    sourceHeight,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
  });

  targetCanvas.width = width;
  targetCanvas.height = height;
  context.clearRect(0, 0, width, height);
  context.save();
  context.filter = getEditorFilterValue(filter);

  if (mirror) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  context.drawImage(
    source,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height,
  );
  context.restore();

  drawFrameOverlay(context, width, height, frame);
  drawStickerOverlay(context, width, height, sticker, mappedStickerAnchor);
}

async function renderEditedImageDataUrl({
  source,
  aspectRatio,
  filter,
  frame,
  sticker,
  stickerAnchor,
}: {
  source: string;
  aspectRatio: AspectRatioOption;
  filter: EditorFilter;
  frame: EditorFrame;
  sticker: EditorSticker;
  stickerAnchor?: StickerAnchor | null;
}) {
  const image = await loadImageElement(source);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is unavailable for image editing.');
  }

  drawStyledImageToCanvas({
    context,
    targetCanvas: canvas,
    source: image,
    sourceWidth: image.width,
    sourceHeight: image.height,
    aspectRatio,
    filter,
    frame,
    sticker,
    stickerAnchor,
  });

  return canvas.toDataURL('image/jpeg', 0.94);
}

export default function App() {
  const [stage, setStage] = useState<AppStage>('home');
  const [image, setImage] = useState<string | null>(null);
  const [editorSourceImage, setEditorSourceImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MoodAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatioOption>('3:4');
  const [editorFilter, setEditorFilter] = useState<EditorFilter>('none');
  const [editorSticker, setEditorSticker] = useState<EditorSticker>('none');
  const [editorFrame, setEditorFrame] = useState<EditorFrame>('none');
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const [stickerAnchor, setStickerAnchor] = useState<StickerAnchor>(getDefaultStickerAnchor());
  const [isFaceTrackingActive, setIsFaceTrackingActive] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'preparing' | 'shared' | 'downloaded' | 'copied' | 'error'>('idle');
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as HistoryEntry[];
      if (Array.isArray(parsed)) {
        setHistoryEntries(parsed);
      }
    } catch (historyError) {
      console.error('History could not be loaded.', historyError);
    }
  }, []);

  useEffect(() => {
    Object.entries(audioElementsRef.current).forEach(([previewId, audioElement]: [string, HTMLAudioElement | null]) => {
      if (!audioElement) {
        return;
      }

      if (activePreviewId === previewId) {
        void audioElement.play().catch((playbackError) => {
          console.error('Audio preview could not start.', playbackError);
          setActivePreviewId((current) => (current === previewId ? null : current));
        });
      } else {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
    });
  }, [activePreviewId]);

  useEffect(() => {
    if (stage !== 'camera' || !videoElement || !isCameraReady) {
      setIsFaceTrackingActive(false);
      setStickerAnchor(getDefaultStickerAnchor());
      return;
    }

    if (editorSticker === 'none') {
      setIsFaceTrackingActive(false);
      setStickerAnchor(getDefaultStickerAnchor());
      return;
    }

    const FaceDetector = getFaceDetectorCtor();
    if (!FaceDetector) {
      setIsFaceTrackingActive(false);
      setStickerAnchor(getDefaultStickerAnchor());
      return;
    }

    let isCancelled = false;
    let detectionInterval: number | null = null;
    const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });

    const detectFace = async () => {
      if (
        isCancelled ||
        videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        videoElement.videoWidth <= 0 ||
        videoElement.videoHeight <= 0
      ) {
        return;
      }

      try {
        const [face] = await detector.detect(videoElement);
        if (isCancelled) {
          return;
        }

        const box = face?.boundingBox;
        if (!box || box.width <= 0 || box.height <= 0) {
          setIsFaceTrackingActive(false);
          setStickerAnchor(getDefaultStickerAnchor());
          return;
        }

        setIsFaceTrackingActive(true);
        setStickerAnchor({
          centerX: clamp01((box.x + box.width / 2) / videoElement.videoWidth),
          centerY: clamp01((box.y + box.height / 2) / videoElement.videoHeight),
          width: clamp01(box.width / videoElement.videoWidth),
          height: clamp01(box.height / videoElement.videoHeight),
          tracked: true,
        });
      } catch (faceError) {
        console.error('Face detection failed. Falling back to static sticker placement.', faceError);
        if (!isCancelled) {
          setIsFaceTrackingActive(false);
          setStickerAnchor(getDefaultStickerAnchor());
        }
      }
    };

    void detectFace();
    detectionInterval = window.setInterval(() => {
      void detectFace();
    }, 420);

    return () => {
      isCancelled = true;
      if (detectionInterval !== null) {
        window.clearInterval(detectionInterval);
      }
    };
  }, [stage, videoElement, isCameraReady, editorSticker]);

  useEffect(() => {
    if (stage !== 'editor' || !editorSourceImage || !editorCanvasRef.current) {
      return;
    }

    let isCancelled = false;

    const renderPreview = async () => {
      try {
        const imageElement = await loadImageElement(editorSourceImage);
        if (isCancelled || !editorCanvasRef.current) {
          return;
        }

        const context = editorCanvasRef.current.getContext('2d');
        if (!context) {
          return;
        }

        drawStyledImageToCanvas({
          context,
          targetCanvas: editorCanvasRef.current,
          source: imageElement,
          sourceWidth: imageElement.width,
          sourceHeight: imageElement.height,
          aspectRatio: selectedAspectRatio,
          filter: editorFilter,
          frame: editorFrame,
          sticker: editorSticker,
          stickerAnchor,
        });
      } catch (previewError) {
        console.error('Editor preview could not render.', previewError);
        if (!isCancelled) {
          setError('Image preview could not be prepared for editing.');
        }
      }
    };

    void renderPreview();

    return () => {
      isCancelled = true;
    };
  }, [stage, editorSourceImage, selectedAspectRatio, editorFilter, editorFrame, editorSticker, stickerAnchor]);

  const openEditor = (dataUrl: string, options?: { preserveStyling?: boolean }) => {
    setEditorSourceImage(dataUrl);
    if (!options?.preserveStyling) {
      setEditorFilter('none');
      setEditorSticker('none');
      setEditorFrame('none');
      setStickerAnchor(getDefaultStickerAnchor());
      setIsFaceTrackingActive(false);
    }
    setSaveState('idle');
    setStage('editor');
  };

  const startCamera = async (ratio: AspectRatioOption = selectedAspectRatio) => {
    setSelectedAspectRatio(ratio);
    const dimensions = ASPECT_RATIO_DIMENSIONS[ratio];
    const preferredConstraints: MediaStreamConstraints = {
      video: {
        facingMode: 'user',
        width: { ideal: dimensions.width },
        height: { ideal: dimensions.height },
        aspectRatio: { ideal: getAspectRatioValue(ratio) },
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

  const saveCurrentResultToHistory = useCallback(() => {
    if (!analysis || !image) {
      return;
    }

    const entry: HistoryEntry = {
      id: `${Date.now()}`,
      image,
      analysis,
      createdAt: new Date().toISOString(),
      aspectRatio: selectedAspectRatio,
    };

    setHistoryEntries((current) => {
      const next = [entry, ...current.filter((item) => item.image !== image)].slice(0, HISTORY_LIMIT);
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSaveState('saved');
  }, [analysis, image, selectedAspectRatio]);

  const copyInstagramCaption = useCallback(async () => {
    if (!analysis) {
      return;
    }

    try {
      await copyTextToClipboard(buildInstagramCaption(analysis));
      setShareState('copied');
      setShareMessage('Caption copied. Paste it into Instagram after sharing the image.');
    } catch (copyError) {
      console.error('Caption copy failed.', copyError);
      setShareState('error');
      setShareMessage('Caption could not be copied automatically on this browser.');
    }
  }, [analysis]);

  const shareToInstagram = useCallback(async () => {
    if (!analysis || !image) {
      return;
    }

    setShareState('preparing');
    setShareMessage('Preparing Instagram share card...');

    try {
      const caption = buildInstagramCaption(analysis);
      const shareBlob = await buildInstagramShareCard({ imageSource: image, analysis });
      const shareFile = new File([shareBlob], 'moodtune-instagram-share.png', { type: 'image/png' });
      const shareData = {
        title: `MoodTune - ${analysis.mood}`,
        text: caption,
        files: [shareFile],
      };

      if (navigator.share && navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share(shareData);
        setShareState('shared');
        setShareMessage('Share sheet opened. Choose Instagram Stories if it is available on this device.');
        return;
      }

      triggerFileDownload(shareBlob, 'moodtune-instagram-share.png');
      await copyTextToClipboard(caption);
      setShareState('downloaded');
      setShareMessage('Instagram story card downloaded and caption copied. Upload it to Story, then paste the caption.');
    } catch (shareError) {
      console.error('Instagram share preparation failed.', shareError);
      setShareState('error');
      setShareMessage('Instagram share card could not be prepared.');
    }
  }, [analysis, image]);

  const openHistoryEntry = (entry: HistoryEntry) => {
    enrichmentRunRef.current += 1;
    setActivePreviewId(null);
    setImage(entry.image);
    setAnalysis(entry.analysis);
    setSelectedAspectRatio(entry.aspectRatio);
    setSaveState('saved');
    setShareState('idle');
    setShareMessage(null);
    setStage('results');

    const runId = enrichmentRunRef.current;
    void enrichMusicRecommendations(entry.analysis.recommendations).then((recommendations) => {
      if (enrichmentRunRef.current !== runId) {
        return;
      }

      setAnalysis((current) => (current ? { ...current, recommendations } : current));
    });
  };

  const processImage = async (dataUrl: string) => {
    setImage(dataUrl);
    setEditorSourceImage(null);
    setStage('loading');
    setError(null);
    setActivePreviewId(null);
    setSaveState('idle');
    setShareState('idle');
    setShareMessage(null);
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

    if (!isCameraReady) {
      setError('Camera preview is not ready yet. Please wait a moment and try again.');
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
      const targetRatio = getAspectRatioValue(selectedAspectRatio);
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

      const mappedStickerAnchor = mapStickerAnchorToCroppedOutput({
        anchor: stickerAnchor,
        sourceWidth,
        sourceHeight,
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
      });

      canvasRef.current.width = ASPECT_RATIO_DIMENSIONS[selectedAspectRatio].width;
      canvasRef.current.height = ASPECT_RATIO_DIMENSIONS[selectedAspectRatio].height;
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
      drawStickerOverlay(
        context,
        canvasRef.current.width,
        canvasRef.current.height,
        editorSticker,
        mappedStickerAnchor,
      );
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
    openEditor(dataUrl, { preserveStyling: true });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      openEditor(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const applyEditorChanges = async () => {
    if (!editorSourceImage) {
      return;
    }

    try {
      const editedImage = await renderEditedImageDataUrl({
        source: editorSourceImage,
        aspectRatio: selectedAspectRatio,
        filter: editorFilter,
        frame: editorFrame,
        sticker: editorSticker,
        stickerAnchor,
      });
      await processImage(editedImage);
    } catch (editorError) {
      console.error('Editor output could not be generated.', editorError);
      setError('The edited image could not be prepared for analysis.');
      setStage('home');
    }
  };

  const reset = () => {
    enrichmentRunRef.current += 1;
    setActivePreviewId(null);
    stopCameraStream();
    setStage('home');
    setImage(null);
    setEditorSourceImage(null);
    setAnalysis(null);
    setError(null);
    setEditorFilter('none');
    setEditorSticker('none');
    setEditorFrame('none');
    setStickerAnchor(getDefaultStickerAnchor());
    setIsFaceTrackingActive(false);
    setSaveState('idle');
    setShareState('idle');
    setShareMessage(null);
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
          className="flex justify-between items-center px-4 md:px-12 py-6 md:py-8 border-b border-[#1A1A1A]/10 w-full gap-3"
        >
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <span className="font-serif text-2xl md:text-3xl font-bold tracking-tighter">MoodTune</span>
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
              <section className="md:w-[45%] p-6 md:p-16 flex flex-col justify-center border-b md:border-b-0 md:border-r border-[#1A1A1A]/10">
                <div className="space-y-8">
                  <h1 className="font-serif text-5xl md:text-8xl leading-[0.9] tracking-tighter">
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

              <section className="flex-1 p-6 md:p-16 flex flex-col items-center justify-center bg-white">
                <div
                  className="w-full max-w-md aspect-[4/3] md:aspect-square border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center gap-6 group cursor-pointer hover:border-black transition-all duration-500 hover:bg-[#FAF9F6]"
                  onClick={() => {
                    void startCamera();
                  }}
                >
                  <div className="w-16 h-16 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center group-hover:bg-[#1A1A1A] transition-colors duration-500">
                    <Camera className="w-6 h-6 text-[#1A1A1A] group-hover:text-white" />
                  </div>
                  <div className="text-center">
                    <span className="text-xs font-bold tracking-widest uppercase block mb-2">Initialize Vision</span>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Capture or Upload</p>
                  </div>
                </div>

                <div className="mt-10 md:mt-12 flex flex-col items-center gap-6 w-full max-w-md">
                  <div className="w-full flex items-center gap-4">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-[9px] uppercase tracking-[0.3em] text-gray-300 font-bold">Options</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>

                  <div className="flex gap-3 md:gap-4 w-full">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 h-13 md:h-14 rounded-full border border-gray-200 hover:border-black font-bold text-[9px] md:text-[10px] uppercase tracking-[0.22em] md:tracking-widest transition-all"
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

                {historyEntries.length > 0 && (
                  <div className="mt-10 md:mt-12 w-full max-w-md">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-black/60" />
                        <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-gray-400">History</span>
                      </div>
                      <span className="text-[9px] md:text-[10px] text-gray-400 italic font-serif">Saved locally</span>
                    </div>
                    <div className="space-y-3 max-h-64 md:max-h-72 overflow-y-auto panel-scrollbar pr-1">
                      {historyEntries.map((entry) => (
                        <button
                          key={entry.id}
                          onClick={() => openHistoryEntry(entry)}
                          className="w-full rounded-2xl border border-[#1A1A1A]/8 bg-[#FAF9F6] p-3 text-left transition-colors hover:border-black/20"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={entry.image}
                              alt={`${entry.analysis.mood} history item`}
                              className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-black/40">
                                {entry.analysis.sourceLabel}
                              </p>
                              <h4 className="font-serif text-lg leading-none mt-1">{entry.analysis.mood}</h4>
                              <p className="text-[10px] text-gray-500 mt-1 truncate">{entry.analysis.vibe}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </motion.div>
          )}

          {stage === 'camera' && (
            <motion.div
              key="camera"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 p-4 md:p-16 flex items-center justify-center"
            >
              <div className={`w-full max-w-md md:max-w-3xl ${
                selectedAspectRatio === '3:4' ? 'aspect-[3/4] md:aspect-[3/4] md:max-w-lg' : 'aspect-[16/9]'
              } rounded-[1.9rem] md:rounded-[2.5rem] overflow-hidden relative border border-[#1A1A1A]/10 bg-black/5 shadow-2xl`}>
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute top-4 right-4 md:top-6 md:right-6 flex flex-wrap justify-end gap-2 max-w-[50%] md:max-w-[72%]">
                  {(['3:4', '16:9'] as AspectRatioOption[]).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => {
                        void startCamera(ratio);
                      }}
                      className={`glass rounded-full px-2.5 md:px-3 py-2 text-[8px] md:text-[9px] font-bold uppercase tracking-[0.16em] md:tracking-[0.2em] ${
                        selectedAspectRatio === ratio ? 'text-black' : 'text-black/45'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
                <div className="absolute left-3 right-3 md:left-6 md:right-6 bottom-3 md:bottom-6">
                  <div className="mx-auto flex w-full md:w-auto gap-1.5 md:gap-2 overflow-x-auto no-scrollbar pb-1 justify-start md:justify-center">
                    {([
                      ['none', 'Clean'],
                      ['hearts', 'Hearts'],
                      ['sparkles', 'Sparkles'],
                      ['blush', 'Blush'],
                      ['pixel', 'Pixel Pop'],
                    ] as [EditorSticker, string][]).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setEditorSticker(value)}
                        className={`glass whitespace-nowrap rounded-full px-2.5 md:px-3 py-1.5 md:py-2 text-[7px] md:text-[9px] font-bold uppercase tracking-[0.12em] md:tracking-[0.18em] ${
                          editorSticker === value ? 'text-black border-black/15' : 'text-black/45'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <StickerPreviewOverlay
                  sticker={editorSticker}
                  anchor={stickerAnchor}
                  faceTrackingActive={isFaceTrackingActive}
                />
                {!isCameraReady && (
                  <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px] flex items-center justify-center">
                    <div className="glass px-4 md:px-5 py-3 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-[0.22em] md:tracking-[0.3em]">
                      {isCameraStarting ? 'Waiting For Camera' : 'Preparing Preview'}
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-16 md:bottom-14 flex justify-center items-center">
                  <button
                    onClick={capturePhoto}
                    disabled={!isCameraReady}
                    className={`w-14 h-14 md:w-18 md:h-18 rounded-full border-2 border-white/40 flex items-center justify-center p-1.5 group bg-white/10 backdrop-blur-md transition-opacity ${
                      isCameraReady ? 'opacity-100' : 'opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="w-full h-full rounded-full bg-white group-hover:scale-110 transition-transform" />
                  </button>
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </motion.div>
          )}

          {stage === 'editor' && editorSourceImage && (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_24rem] gap-6 md:gap-8 p-4 md:p-12 items-start"
            >
              <section className="bg-white rounded-[1.75rem] md:rounded-[2rem] border border-[#1A1A1A]/8 p-4 md:p-8 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-gray-400">Edit Before Analysis</p>
                    <h2 className="font-serif text-2xl md:text-3xl mt-2">Tune the frame.</h2>
                  </div>
                  <button
                    type="button"
                    onClick={applyEditorChanges}
                    className="w-full sm:w-auto rounded-full bg-black px-5 py-3 text-[10px] font-bold uppercase tracking-[0.24em] text-white"
                  >
                    Analyze Edit
                  </button>
                </div>

                <div className="rounded-[1.5rem] md:rounded-[2rem] bg-[#f2eee7] p-3 md:p-6">
                  <div className={`mx-auto overflow-hidden rounded-[1.75rem] shadow-xl bg-black/10 ${
                    selectedAspectRatio === '3:4' ? 'max-w-md aspect-[3/4]' : 'max-w-4xl aspect-[16/9]'
                  }`}>
                    <canvas ref={editorCanvasRef} className="w-full h-full object-cover" />
                  </div>
                </div>
              </section>

              <aside className="bg-white rounded-[1.75rem] md:rounded-[2rem] border border-[#1A1A1A]/8 p-4 md:p-6 shadow-sm space-y-6 xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto panel-scrollbar">
                <div className="space-y-5">
                  <EditorOptionGroup icon={<SlidersHorizontal className="w-4 h-4" />} label="Ratio">
                    {(['3:4', '16:9'] as AspectRatioOption[]).map((ratio) => (
                      <React.Fragment key={ratio}>
                        <EditorChip
                          label={ratio}
                          active={selectedAspectRatio === ratio}
                          onClick={() => setSelectedAspectRatio(ratio)}
                        />
                      </React.Fragment>
                    ))}
                  </EditorOptionGroup>

                  <EditorOptionGroup icon={<Sparkles className="w-4 h-4" />} label="Filter">
                    {([
                      ['none', 'Natural'],
                      ['warm', 'Warm'],
                      ['mono', 'Mono'],
                      ['dreamy', 'Dreamy'],
                    ] as [EditorFilter, string][]).map(([value, label]) => (
                      <React.Fragment key={value}>
                        <EditorChip
                          label={label}
                          active={editorFilter === value}
                          onClick={() => setEditorFilter(value)}
                        />
                      </React.Fragment>
                    ))}
                  </EditorOptionGroup>

                  <EditorOptionGroup icon={<Frame className="w-4 h-4" />} label="Frame">
                    {([
                      ['none', 'None'],
                      ['postcard', 'Postcard'],
                      ['cinema', 'Cinema'],
                    ] as [EditorFrame, string][]).map(([value, label]) => (
                      <React.Fragment key={value}>
                        <EditorChip
                          label={label}
                          active={editorFrame === value}
                          onClick={() => setEditorFrame(value)}
                        />
                      </React.Fragment>
                    ))}
                  </EditorOptionGroup>

                  <EditorOptionGroup icon={<Sparkles className="w-4 h-4" />} label="Sticker">
                    {([
                      ['none', 'Clean'],
                      ['hearts', 'Love Love'],
                      ['sparkles', 'Sparkles'],
                      ['blush', 'Blush'],
                      ['pixel', 'Pixel Pop'],
                    ] as [EditorSticker, string][]).map(([value, label]) => (
                      <React.Fragment key={value}>
                        <EditorChip
                          label={label}
                          active={editorSticker === value}
                          onClick={() => setEditorSticker(value)}
                        />
                      </React.Fragment>
                    ))}
                  </EditorOptionGroup>
                </div>

                <div className="rounded-[1.5rem] md:rounded-3xl border border-[#1A1A1A]/8 bg-[#FAF9F6] p-4 text-[13px] md:text-sm text-gray-500 leading-relaxed space-y-2">
                  <p>Rasio mengatur crop final untuk camera dan upload. Filter, frame, dan sticker akan ikut masuk ke gambar yang dianalisis dan disimpan.</p>
                  <p>
                    Live sticker preview memakai pelacakan wajah ringan jika browser mendukungnya. Jika tidak, posisi sticker akan tetap fallback ke area kepala default.
                  </p>
                </div>
              </aside>
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
              <section className="md:w-[40%] p-6 md:p-12 border-b md:border-b-0 md:border-r border-[#1A1A1A]/10 flex flex-col">
                <div className="flex-1 space-y-10">
                  <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-gray-100 aspect-[4/5] md:aspect-auto md:flex-1">
                    <img src={image!} alt="Captured" className="w-full h-full object-cover" />
                    <div className="absolute top-4 left-4 md:top-6 md:left-6 flex flex-wrap gap-2">
                      <span className="glass px-3 md:px-4 py-1.5 rounded-full text-[8px] md:text-[9px] font-bold uppercase tracking-[0.18em] md:tracking-widest shadow-sm">
                        Detected: {analysis.mood}
                      </span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 glass flex justify-between items-end gap-3">
                      <div className="flex gap-1.5">
                        {analysis.colors.slice(0, 3).map((_, index) => (
                          <div key={index} className="w-3 h-3 rounded-full bg-black/20" />
                        ))}
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] uppercase font-bold opacity-40">Analysis Source</p>
                        <p className="font-serif text-sm md:text-lg leading-none">{analysis.sourceLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h2 className="font-serif text-4xl md:text-5xl leading-none tracking-tighter">
                      {analysis.mood}
                    </h2>
                    <p className="text-sm text-gray-500 italic font-serif leading-relaxed md:pr-8">
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
                    {shareMessage && (
                      <div className={`rounded-2xl border p-4 text-xs ${
                        shareState === 'error'
                          ? 'border-red-500/20 bg-red-500/5 text-red-700'
                          : 'border-black/10 bg-black/5 text-black/70'
                      }`}>
                        {shareMessage}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex-1 p-6 md:p-12 bg-white flex flex-col">
                <div className="flex-1 space-y-12">
                  <header className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 pb-4 border-b border-gray-100">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-1">Selections</h3>
                      <p className="text-[10px] text-gray-400 font-medium">Curated for your specific visual resonance</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          void shareToInstagram();
                        }}
                        className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-[0.18em] md:tracking-[0.22em] transition-colors ${
                          shareState === 'preparing'
                            ? 'border-black bg-black text-white'
                            : 'border-[#1A1A1A]/10 text-[#1A1A1A]/70 hover:border-black hover:text-black'
                        }`}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{shareState === 'preparing' ? 'Preparing...' : 'Share Story Card'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void copyInstagramCaption();
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1A1A1A]/10 px-4 py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-[0.18em] md:tracking-[0.22em] text-[#1A1A1A]/70 transition-colors hover:border-black hover:text-black"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Caption</span>
                      </button>
                      <button
                        type="button"
                        onClick={saveCurrentResultToHistory}
                        className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-[0.18em] md:tracking-[0.22em] transition-colors ${
                          saveState === 'saved'
                            ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700'
                            : 'border-[#1A1A1A]/10 text-[#1A1A1A]/70 hover:border-black hover:text-black'
                        }`}
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" />
                        <span>{saveState === 'saved' ? 'Saved' : 'Save to History'}</span>
                      </button>
                      <div
                        className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                        onClick={reset}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </div>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 min-h-0">
                    <EditorialGroup
                      title="Soundtrack"
                      items={analysis.recommendations.filter((item) => item.type === 'song')}
                      activePreviewId={activePreviewId}
                      onTogglePreview={setActivePreviewId}
                      audioElementsRef={audioElementsRef}
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

        <footer className="px-4 md:px-12 py-8 border-t border-[#1A1A1A]/10 flex flex-col md:row justify-between items-center gap-4 text-[9px] uppercase tracking-[0.2em] font-semibold text-gray-400">
          <div className="flex flex-wrap justify-center gap-3 md:gap-6">
            
          </div>
          <div className="italic opacity-60 text-center">
            MoodTune Studio &copy; 2026 - Sensory Translation Module copyright &copy; 2026 Yizreel Schwartz.
          </div>
        </footer>
      </main>
    </div>
  );
}

type EditorOptionGroupProps = {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
};

type EditorChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function EditorOptionGroup({
  icon,
  label,
  children,
}: EditorOptionGroupProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[9px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.28em] font-bold text-gray-400">
        <span className="text-black/55 shrink-0">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  );
}

function EditorChip({
  label,
  active,
  onClick,
}: EditorChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 md:px-4 py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-[0.16em] md:tracking-[0.22em] transition-colors ${
        active
          ? 'bg-black text-white'
          : 'border border-[#1A1A1A]/10 text-[#1A1A1A]/65 hover:border-black hover:text-black'
      }`}
    >
      {label}
    </button>
  );
}

function StickerPreviewOverlay({
  sticker,
  anchor,
  faceTrackingActive,
}: {
  sticker: EditorSticker;
  anchor: StickerAnchor;
  faceTrackingActive: boolean;
}) {
  if (sticker === 'none') {
    return null;
  }

  const left = `${anchor.centerX * 100}%`;
  const top = `${anchor.centerY * 100}%`;
  const faceWidth = `${Math.max(18, anchor.width * 100)}%`;
  const faceHeight = `${Math.max(18, anchor.height * 100)}%`;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-3 md:left-6 bottom-20 md:bottom-24 glass rounded-full px-3 py-2 text-[8px] md:text-[9px] font-bold uppercase tracking-[0.16em] md:tracking-[0.2em] text-black/70 max-w-[52%] md:max-w-none">
        {faceTrackingActive ? 'Face Lock' : 'Centered Overlay'}
      </div>
      <div
        className="absolute"
        style={{
          left,
          top,
          width: faceWidth,
          height: faceHeight,
          transform: 'translate(-50%, -50%)',
        }}
      >
        {sticker === 'hearts' && <HeartsAroundHead />}
        {sticker === 'sparkles' && <SparklesAroundHead />}
        {sticker === 'blush' && <BlushAroundFace />}
        {sticker === 'pixel' && <PixelPopAroundHead />}
      </div>
    </div>
  );
}

function HeartsAroundHead() {
  return (
    <>
      <HeartStickerCluster className="absolute -left-[40%] -top-[26%] w-[44%] animate-heart-float" />
      <HeartStickerCluster className="absolute left-[8%] -top-[38%] w-[24%] animate-heart-float-soft" compact />
      <HeartStickerCluster className="absolute right-[-32%] -top-[22%] w-[40%] animate-heart-float-delayed" mirrored />
      <HeartStickerCluster className="absolute right-[8%] -top-[40%] w-[22%] animate-heart-float-soft" compact mirrored />
      <div className="absolute left-[22%] -top-[10%] w-2 h-2 rounded-full bg-white/90 blur-[0.5px]" />
      <div className="absolute right-[20%] -top-[2%] w-1.5 h-1.5 rounded-full bg-white/80 blur-[0.5px]" />
    </>
  );
}

function SparklesAroundHead() {
  return (
    <>
      <SparkleGlyph className="absolute -left-[24%] -top-[4%] w-[24%] text-[#ffe28b] animate-sparkle-twirl" />
      <SparkleGlyph className="absolute left-[14%] -top-[30%] w-[18%] text-[#fff3c4] animate-sparkle-twirl-delayed" />
      <SparkleGlyph className="absolute left-[42%] -top-[36%] w-[22%] text-[#ffefad] animate-sparkle-twirl" />
      <SparkleGlyph className="absolute right-[6%] -top-[18%] w-[16%] text-[#fff7de] animate-sparkle-twirl-delayed" />
      <SparkleGlyph className="absolute -right-[18%] top-[4%] w-[26%] text-[#ffdd7e] animate-sparkle-twirl" />
    </>
  );
}

function BlushAroundFace() {
  return (
    <>
      <div className="absolute left-[4%] top-[42%] h-[22%] w-[34%] rounded-full bg-[#ff8cb8]/30 blur-xl animate-blush-pulse" />
      <div className="absolute right-[4%] top-[42%] h-[22%] w-[34%] rounded-full bg-[#ff8cb8]/30 blur-xl animate-blush-pulse-delayed" />
      <HeartStickerCluster className="absolute -left-[20%] top-[4%] w-[20%] animate-heart-float-soft" compact />
      <HeartStickerCluster className="absolute right-[-18%] top-[10%] w-[20%] animate-heart-float-soft" compact mirrored />
    </>
  );
}

function PixelPopAroundHead() {
  return (
    <>
      <PixelHeartGlyph className="absolute -left-[26%] top-[0%] w-[26%] text-[#ff77a8] animate-pixel-pop" />
      <PixelHeartGlyph className="absolute right-[-14%] -top-[14%] w-[20%] text-[#ffb2d0] animate-pixel-pop-delayed" />
      <SparkleGlyph className="absolute left-[36%] -top-[28%] w-[14%] text-[#9fefff] animate-sparkle-twirl" />
      <SparkleGlyph className="absolute right-[18%] top-[2%] w-[12%] text-[#ffe28b] animate-sparkle-twirl-delayed" />
    </>
  );
}

function HeartStickerCluster({
  className,
  mirrored = false,
  compact = false,
}: {
  className?: string;
  mirrored?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`${className ?? ''} ${mirrored ? '-scale-x-100' : ''}`.trim()}>
      <div className={`relative aspect-[1.15] ${compact ? 'w-full' : 'w-full'}`}>
        <HeartGlyph className={`absolute left-0 ${compact ? 'top-[26%] w-[70%]' : 'top-[18%] w-[72%]'} text-[#ff7ca9]`} />
        <HeartGlyph className={`absolute ${compact ? 'left-[52%] top-[2%] w-[34%]' : 'left-[50%] top-[0%] w-[36%]'} text-[#ffc4da]`} />
      </div>
    </div>
  );
}

function HeartGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M32 55.2c-.8 0-1.6-.3-2.2-.9L10.9 36.1C2.7 27.9 2.4 14.8 10 8.2c6.1-5.3 15.2-4.6 20.6 1.2L32 11l1.4-1.6c5.4-5.9 14.6-6.5 20.6-1.2 7.6 6.6 7.3 19.7-.9 27.9L34.2 54.3c-.6.6-1.4.9-2.2.9Z"
        fill="currentColor"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M32 4L38.6 25.4L60 32L38.6 38.6L32 60L25.4 38.6L4 32L25.4 25.4L32 4Z"
        fill="currentColor"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PixelHeartGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" aria-hidden="true" className={className}>
      <path
        d="M8 8H16V0H24V8H40V0H48V8H56V16H64V32H56V40H48V48H40V56H24V48H16V40H8V32H0V16H8V8Z"
        fill="currentColor"
        stroke="rgba(255,255,255,0.88)"
        strokeWidth="3"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function EditorialGroup({
  title,
  items,
  activePreviewId,
  onTogglePreview,
  audioElementsRef,
}: {
  title: string;
  items: Recommendation[];
  activePreviewId?: string | null;
  onTogglePreview?: React.Dispatch<React.SetStateAction<string | null>>;
  audioElementsRef?: React.MutableRefObject<Record<string, HTMLAudioElement | null>>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 min-h-0"
    >
      <div className="flex justify-between items-center pb-2 border-b border-gray-100">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{title}</h3>
        <span className="text-[10px] font-serif italic text-gray-400">
          {items.length} Curated Match{items.length === 1 ? '' : 'es'}
        </span>
      </div>

      <div className="space-y-4 md:max-h-[38rem] md:overflow-y-auto md:pr-2 panel-scrollbar">
        {items.map((item, index) =>
          <React.Fragment key={index}>
            {item.type === 'song'
              ? (
                <SongCard
                  item={item}
                  activePreviewId={activePreviewId ?? null}
                  onTogglePreview={onTogglePreview}
                  audioElementsRef={audioElementsRef}
                />
              )
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

function SongCard({
  item,
  activePreviewId,
  onTogglePreview,
  audioElementsRef,
}: {
  item: Recommendation;
  activePreviewId: string | null;
  onTogglePreview?: React.Dispatch<React.SetStateAction<string | null>>;
  audioElementsRef?: React.MutableRefObject<Record<string, HTMLAudioElement | null>>;
}) {
  const links = getRecommendationLinks(item);
  const previewId = `${item.title}::${item.creator}`;
  const hasPreview = Boolean(item.preview?.audioPreviewUrl);
  const isPlaying = activePreviewId === previewId;
  const primaryHref = links.primary === 'youtube' ? links.youtube : links.spotify;

  const togglePreview = () => {
    if (hasPreview && onTogglePreview) {
      onTogglePreview((current) => (current === previewId ? null : previewId));
      return;
    }

    if (primaryHref) {
      window.open(primaryHref, '_blank', 'noopener,noreferrer');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePreview();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={togglePreview}
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
          <div className="min-w-0 pr-2">
            <h4 className="text-xs font-bold tracking-tight leading-snug whitespace-normal break-words">
              {item.title}
            </h4>
            <p className="text-[9px] uppercase tracking-widest text-gray-500 mt-1 whitespace-normal break-words leading-relaxed">
              {item.creator}
            </p>
            {item.preview?.albumTitle && (
              <p className="text-[10px] text-gray-400 mt-1 italic whitespace-normal break-words leading-relaxed">
                {item.preview.albumTitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {!hasPreview && (
              <ExternalLink className="w-3.5 h-3.5 text-black/30 group-hover:text-black/60 transition-colors" />
            )}
          </div>
        </div>

        <p className="text-[10px] text-gray-400 leading-tight mt-2 line-clamp-2 font-light">{item.description}</p>
        {item.preview?.audioPreviewUrl && (
          <div
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#1A1A1A]/8 bg-white/70 px-3 py-2.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  togglePreview();
                }}
                className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center flex-shrink-0 hover:scale-105 transition-transform"
                aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                )}
              </button>
              <div className={`flex items-end gap-0.5 h-4 ${isPlaying ? 'opacity-100' : 'opacity-40'} transition-opacity`}>
                {[0, 1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    className={`equalizer-bar ${isPlaying ? 'is-playing' : ''}`}
                    style={{ animationDelay: `${bar * 0.12}s` }}
                  />
                ))}
              </div>
            </div>
            <audio
              preload="none"
              src={item.preview.audioPreviewUrl}
              ref={(node) => {
                if (audioElementsRef) {
                  audioElementsRef.current[previewId] = node;
                }
              }}
              onEnded={() => onTogglePreview?.((current) => (current === previewId ? null : current))}
              className="hidden"
            />
          </div>
        )}
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

