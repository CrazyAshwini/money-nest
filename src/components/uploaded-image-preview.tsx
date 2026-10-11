"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Modal } from "./ui";
import "./uploaded-image-preview.css";

export type UploadedPhoto = {
  id: string;
  name: string;
  url: string;
};

type UploadedImagePreviewProps = {
  photos: UploadedPhoto[];
  initialPhotoId: string;
  returnFocusTo: HTMLButtonElement;
  onClose: () => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/** The uploader owns these local URLs. Viewing never uploads or alters a photo. */
export function UploadedImagePreview({
  photos,
  initialPhotoId,
  returnFocusTo,
  onClose,
}: UploadedImagePreviewProps) {
  const [photoId, setPhotoId] = useState(initialPhotoId);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ id: "", width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.id === photoId),
  );
  const activePhoto = photos[index];

  function navigate(direction: -1 | 1) {
    const nextPhoto =
      photos[(index + direction + photos.length) % photos.length];
    if (!nextPhoto) return;
    setPhotoId(nextPhoto.id);
    setZoom(MIN_ZOOM);
    viewport.current?.scrollTo(0, 0);
  }

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function measure() {
      if (!element) return;
      const width = Math.max(0, element.clientWidth - 32);
      const height = Math.max(0, element.clientHeight - 32);
      setViewportSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [imageSize.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (photos.length < 2) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextPhoto =
        photos[(index + direction + photos.length) % photos.length];
      if (!nextPhoto) return;
      setPhotoId(nextPhoto.id);
      setZoom(MIN_ZOOM);
      viewport.current?.scrollTo(0, 0);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, photos]);

  // Radix restores the parent dialog's focus scope first; then restore this
  // viewer's exact thumbnail or text opener, rather than its default first input.
  useEffect(() => {
    return () => {
      requestAnimationFrame(() => {
        if (returnFocusTo.isConnected) returnFocusTo.focus();
      });
    };
  }, [returnFocusTo]);

  if (!activePhoto) return null;

  const fittedSize =
    imageSize.id === activePhoto.id &&
    imageSize.width > 0 &&
    imageSize.height > 0 &&
    viewportSize.width > 0 &&
    viewportSize.height > 0
      ? Math.min(
          1,
          viewportSize.width / imageSize.width,
          viewportSize.height / imageSize.height,
        )
      : null;

  return (
    <Modal
      title={`Preview: ${activePhoto.name}`}
      description={`Photo ${index + 1} of ${photos.length}`}
      onClose={onClose}
      className="uploaded-image-modal"
      overlayClassName="uploaded-image-overlay"
    >
      <div
        ref={viewport}
        className="uploaded-image-viewport"
        role="region"
        aria-label="Scrollable image preview"
        // Keyboard users need to focus this overflow region to scroll a zoomed bill.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <div className="uploaded-image-stage">
          <img
            key={activePhoto.id}
            src={activePhoto.url}
            alt={`Full uploaded screenshot: ${activePhoto.name}`}
            className="uploaded-image-full"
            draggable={false}
            style={
              fittedSize === null
                ? undefined
                : {
                    width: Math.round(imageSize.width * fittedSize * zoom),
                    height: Math.round(imageSize.height * fittedSize * zoom),
                    maxWidth: "none",
                    maxHeight: "none",
                  }
            }
            onLoad={(event) =>
              setImageSize({
                id: activePhoto.id,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </div>
      <div className="uploaded-image-controls">
        {photos.length > 1 && (
          <div className="uploaded-image-navigation">
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={17} aria-hidden="true" /> Previous
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => navigate(1)}
            >
              Next <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="uploaded-image-zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.5))}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          <span aria-live="polite" aria-atomic="true">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.5))}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => {
              setZoom(MIN_ZOOM);
              viewport.current?.scrollTo(0, 0);
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Reset
          </button>
        </div>
      </div>
    </Modal>
  );
}
