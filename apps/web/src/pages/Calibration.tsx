import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  buildDynamicTemplate,
  buildStaticTemplate,
  motionTrajectory,
  toFeatureVector,
  wristSample,
} from '@enlaza/cv-model';
import type { HandFrame, SignTemplate } from '@enlaza/cv-model';
import { Button } from '../components/Button';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import { cameraAspect, createDetector } from '../cv/detector';
import {
  exportTemplates,
  fetchBundledTemplates,
  importTemplates,
  loadTemplates,
  migrateLegacyTemplates,
  removeTemplate,
  upsertTemplate,
} from '../cv/templates';
import styles from './Calibration.module.css';

const STATIC_SAMPLES_NEEDED = 3;
const DYNAMIC_CAPTURE_MS = 2000;

/**
 * Herramienta interna para grabar plantillas de referencia por seña —
 * el paso manual que sustituye al dataset que aún no existe (README §4.3).
 * Las plantillas se guardan solo en este dispositivo.
 */
export function Calibration() {
  const [searchParams, setSearchParams] = useSearchParams();
  const lessonsQuery = useApi(() => api.lessons());
  const lessonId = searchParams.get('lesson') ?? lessonsQuery.data?.lessons[0]?.id ?? '';
  const lessonQuery = useApi(
    () => (lessonId ? api.lesson(lessonId) : Promise.reject(new Error('Sin lección'))),
    [lessonId],
  );

  const [templates, setTemplates] = useState<SignTemplate[]>(() => loadTemplates());
  const [bundledIds, setBundledIds] = useState<Set<string>>(new Set());
  const [selectedSignId, setSelectedSignId] = useState<string | null>(null);
  const [samples, setSamples] = useState<number[][]>([]);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [handVisible, setHandVisible] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const latestFrame = useRef<HandFrame | null>(null);
  const recordingRef = useRef(false);
  const recordingBuffer = useRef<HandFrame[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const signs = lessonQuery.data?.signs ?? [];
  const selectedSign = signs.find((s) => s.id === selectedSignId) ?? null;
  const templatesBySign = useMemo(
    () => new Map(templates.map((t) => [t.signId, t])),
    [templates],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchBundledTemplates().then((bundled) => {
      if (!cancelled) setBundledIds(new Set(bundled.map((t) => t.signId)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const detector = createDetector();
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function boot() {
      const video = videoRef.current;
      if (!video) return;
      try {
        if (detector.needsCamera) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          await video.play();
        }
        // Plantillas grabadas antes de la corrección de proporción: se migran
        // con la proporción de esta cámara, que es la que las grabó.
        const aspect = cameraAspect(video, detector);
        if (aspect && migrateLegacyTemplates(aspect).length > 0 && !cancelled) {
          setTemplates(loadTemplates());
        }
        await detector.start(video, (frame) => {
          latestFrame.current = frame;
          setHandVisible(frame !== null);
          if (frame && recordingRef.current) {
            recordingBuffer.current.push(frame);
          }
        });
      } catch {
        if (!cancelled) setMessage('No pudimos iniciar la cámara.');
      }
    }

    void boot();
    return () => {
      cancelled = true;
      detector.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function selectSign(id: string) {
    setSelectedSignId(id);
    setSamples([]);
    setMessage(null);
  }

  function captureStaticSample() {
    const frame = latestFrame.current;
    if (!frame || !selectedSign) {
      setMessage('No vemos ninguna mano en este momento.');
      return;
    }
    const vector = toFeatureVector(frame.landmarks, frame.handedness, frame.aspect);
    const next = [...samples, vector];
    setSamples(next);
    setMessage(`Muestra ${next.length} capturada.`);
    if (next.length >= STATIC_SAMPLES_NEEDED) {
      setTemplates(upsertTemplate(buildStaticTemplate(selectedSign.id, next)));
      setSamples([]);
      setMessage(`Plantilla de "${selectedSign.gloss}" guardada (${next.length} muestras).`);
    }
  }

  function captureDynamic() {
    if (!selectedSign) return;
    recordingBuffer.current = [];
    recordingRef.current = true;
    setRecording(true);
    setMessage('Grabando… haz la seña completa.');
    window.setTimeout(() => {
      recordingRef.current = false;
      setRecording(false);
      const frames = recordingBuffer.current;
      if (frames.length < 8) {
        setMessage('No capturamos suficientes cuadros con la mano visible. Intenta de nuevo.');
        return;
      }
      const vectors = frames.map((f) => toFeatureVector(f.landmarks, f.handedness, f.aspect));
      // Con la trayectoria de la muñeca, para que la seña no se valide con la
      // mano quieta (D36).
      const motion = motionTrajectory(
        frames.map((f) => wristSample(f.landmarks, f.handedness, f.aspect)),
      );
      setTemplates(
        upsertTemplate(buildDynamicTemplate(selectedSign.id, vectors, undefined, motion)),
      );
      setMessage(`Plantilla dinámica de "${selectedSign.gloss}" guardada (${frames.length} cuadros).`);
    }, DYNAMIC_CAPTURE_MS);
  }

  function handleExport() {
    const blob = new Blob([exportTemplates()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enlaza-plantillas-lsc.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    try {
      setTemplates(importTemplates(await file.text()));
      setMessage('Plantillas importadas.');
    } catch {
      setMessage('El archivo no tiene el formato esperado.');
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/" className={styles.backLink}>
          ← Mi ruta
        </Link>
        <h1 className={styles.title}>Calibración de plantillas</h1>
        <p className={styles.subtitle}>
          Graba la referencia de cada seña usando el material fuente (p. ej. el video del
          alfabeto LSC). Las plantillas se guardan solo en este dispositivo.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.videoPanel}>
          <div className={styles.videoFrame}>
            <video ref={videoRef} className={styles.video} playsInline muted />
            <span
              className={handVisible ? styles.handBadgeVisible : styles.handBadge}
            >
              {handVisible ? 'mano detectada' : 'sin mano'}
            </span>
            {recording && <span className={styles.recBadge}>● grabando</span>}
          </div>

          {selectedSign ? (
            <div className={styles.captureBox}>
              <span className={styles.captureTitle}>
                {selectedSign.gloss} ·{' '}
                {selectedSign.signType === 'static' ? 'estática' : 'dinámica'}
              </span>
              {selectedSign.signType === 'static' ? (
                <>
                  <span className={styles.captureHint}>
                    Haz la seña y captura {STATIC_SAMPLES_NEEDED} muestras (varía un poco el
                    ángulo entre una y otra).
                  </span>
                  <Button variant="primary" onClick={captureStaticSample}>
                    Capturar muestra ({samples.length}/{STATIC_SAMPLES_NEEDED})
                  </Button>
                </>
              ) : (
                <>
                  <span className={styles.captureHint}>
                    Al pulsar, tienes {DYNAMIC_CAPTURE_MS / 1000} segundos para hacer la seña
                    completa frente a la cámara.
                  </span>
                  <Button variant="primary" onClick={captureDynamic} disabled={recording}>
                    {recording ? 'Grabando…' : 'Grabar seña (2 s)'}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <p className={styles.captureHint}>Elige una seña de la lista para grabar su plantilla.</p>
          )}

          {message && <p className={styles.message}>{message}</p>}
        </div>

        <div className={styles.listPanel}>
          <label className={styles.lessonPicker}>
            <span className={styles.pickerLabel}>Lección</span>
            <select
              className={styles.select}
              value={lessonId}
              onChange={(e) => setSearchParams({ lesson: e.target.value })}
            >
              {(lessonsQuery.data?.lessons ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.signList}>
            {signs.map((sign) => {
              const has = templatesBySign.has(sign.id);
              return (
                <div
                  key={sign.id}
                  className={
                    sign.id === selectedSignId ? styles.signRowActive : styles.signRow
                  }
                >
                  <button
                    type="button"
                    className={styles.signButton}
                    onClick={() => selectSign(sign.id)}
                  >
                    <span
                      className={has || bundledIds.has(sign.id) ? styles.dotDone : styles.dotPending}
                    />
                    <span>{sign.gloss}</span>
                    <span className={styles.signType}>
                      {sign.signType === 'static' ? 'est.' : 'din.'}
                      {!has && bundledIds.has(sign.id) ? ' · incluida' : ''}
                    </span>
                  </button>
                  {has && (
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => setTemplates(removeTemplate(sign.id))}
                      aria-label={`Borrar plantilla de ${sign.gloss}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.ioRow}>
            <Button variant="outline" onClick={handleExport}>
              Exportar JSON
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Importar JSON
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className={styles.hiddenInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
