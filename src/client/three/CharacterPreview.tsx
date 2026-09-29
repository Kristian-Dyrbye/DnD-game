/**
 * Live, rotatable 3D preview of a character (creator + character screen). Rebuilds the model when
 * the appearance changes; renders only while mounted; shows a friendly message if the models
 * haven't been downloaded yet (Setup.bat runs scripts/assets-fetch.mjs).
 */
import type { ScarLocation } from '../../engine/core/creature';
import type { WoundLevel } from '../../engine/appearance/wounds';
import { lookKey, type EquipmentLook } from '../../engine/appearance/equipmentVisuals';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Appearance } from '../../engine/appearance/appearance';
import { buildCharacterModel, type CharacterModel } from './characterModel';
import { settings } from '../ui/settingsState';

/** Points the camera at the model so the whole figure fits (models differ in scale). */
function frame(camera: THREE.PerspectiveCamera, controls: OrbitControls, obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fit = (size.y / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;
  controls.target.copy(center);
  camera.position.set(center.x, center.y + size.y * 0.08, center.z + fit);
  controls.minDistance = fit * 0.6;
  controls.maxDistance = fit * 1.8;
  controls.update();
}

export function CharacterPreview({ appearance, size = 'medium', height = 260, look, wounds = 0, seed = 'hero', scars = [] }: { appearance: Appearance; size?: string; height?: number; look?: EquipmentLook; wounds?: WoundLevel; seed?: string; scars?: readonly ScarLocation[] }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; model?: CharacterModel } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One renderer/scene per mounted preview.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setError('3D preview unavailable (WebGL is disabled).');
      return;
    }
    // Texture quality → render resolution; the frame cap below keeps idle previews cheap.
    const perf = settings.value?.performance;
    const maxRatio = perf?.textureQuality === 'low' ? 1 : perf?.textureQuality === 'high' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    const frameMs = 1000 / Math.min(perf?.fpsCap ?? 60, 60);
    renderer.setSize(el.clientWidth, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / height, 0.1, 50);
    camera.position.set(0, 1.4, 4.2);
    scene.add(new THREE.HemisphereLight(0xfff2dd, 0x2a2016, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: 0x2c251c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enablePan = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.update();

    sceneRef.current = { scene, camera, controls };
    const clock = new THREE.Clock();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameMs) return;
      last = now;
      sceneRef.current?.model?.update(clock.getDelta());
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      renderer.setSize(el.clientWidth, height);
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      sceneRef.current?.model?.dispose();
      sceneRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [height]);

  // Wounds follow HP (overlays fade in/out inside the model).
  const woundsRef = useRef(wounds);
  woundsRef.current = wounds;
  useEffect(() => {
    sceneRef.current?.model?.setWounds?.(wounds, seed);
  }, [wounds, seed]);

  // (Re)build the model when the look changes.
  const key = JSON.stringify(appearance) + size + lookKey(look) + scars.join(',');
  useEffect(() => {
    let cancelled = false;
    buildCharacterModel(appearance, size, look, scars)
      .then((model) => {
        const holder = sceneRef.current;
        if (cancelled || !holder) return model.dispose();
        if (holder.model) {
          holder.scene.remove(holder.model.root);
          holder.model.dispose();
        }
        holder.model = model;
        model.setWounds?.(woundsRef.current, seed);
        holder.scene.add(model.root);
        frame(holder.camera, holder.controls, model.root);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('3D models not found. Run Setup.bat to download them.');
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <div class="character-preview" ref={host} style={{ height: `${height}px` }} aria-label="3D character preview (drag to rotate)">
      {error && <p class="preview-error">{error}</p>}
    </div>
  );
}
