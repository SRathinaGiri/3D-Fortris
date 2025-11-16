import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { AnaglyphEffect } from 'three/examples/jsm/effects/AnaglyphEffect.js';
import { BOARD_SIZE } from '../hooks/gameSettings.js';

const BLOCK_SIZE = 0.9;

function buildMesh(group, grid, activePiece, materialCache, clearingLayers) {
  const geometry = materialCache.geometry;
  group.clear();
  const offset = {
    x: -(BOARD_SIZE.width / 2) + 0.5,
    y: -(BOARD_SIZE.height / 2) + 0.5,
    z: -(BOARD_SIZE.depth / 2) + 0.5,
  };

  const getMaterial = (color, options = {}) => {
    const key = `${color}-${options.transparent ? 't' : 'o'}-${options.emissive ?? '0'}`;
    if (!materialCache[key]) {
      materialCache[key] = new THREE.MeshStandardMaterial({
        color,
        transparent: Boolean(options.transparent),
        opacity: options.transparent ? 0.35 : 1,
        emissive: options.emissive ? new THREE.Color(options.emissive) : undefined,
      });
    }
    return materialCache[key];
  };

  const createCube = (position, color, options = {}) => {
    const mesh = new THREE.Mesh(geometry, getMaterial(color, options));
    mesh.position.set(
      (position.x + offset.x) * BLOCK_SIZE,
      (position.y + offset.y) * BLOCK_SIZE,
      (position.z + offset.z) * BLOCK_SIZE,
    );
    group.add(mesh);
  };

  grid.forEach((layer, y) => {
    layer.forEach((row, z) => {
      row.forEach((cell, x) => {
        if (cell) {
          const highlight = clearingLayers.includes(y);
          createCube({ x, y, z }, cell.color, highlight ? { emissive: '#f472b6' } : {});
        }
      });
    });
  });

  if (activePiece) {
    activePiece.cells.forEach(([cx, cy, cz]) => {
      const x = activePiece.position.x + cx;
      const y = activePiece.position.y + cy;
      const z = activePiece.position.z + cz;
      createCube({ x, y, z }, activePiece.color, { transparent: true });
    });
  }
}

function GameCanvas({ grid, activePiece, viewType, stereoSettings, clearingLayers }) {
  const containerRef = useRef(null);
  const rendererRef = useRef();
  const sceneRef = useRef();
  const camerasRef = useRef();
  const frameRef = useRef();
  const anaglyphRef = useRef();
  const stereoRef = useRef();
  const viewRef = useRef(viewType);
  const stereoSettingsRef = useRef(stereoSettings);
  const materialCache = useRef({ geometry: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE) }).current;

  useEffect(() => { viewRef.current = viewType; }, [viewType]);
  useEffect(() => { stereoSettingsRef.current = stereoSettings; }, [stereoSettings]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return () => {};

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020617');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const perspectiveCamera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
    perspectiveCamera.position.set(10, 12, 14);
    perspectiveCamera.lookAt(0, 0, 0);

    const orthoSize = 10;
    const orthoCamera = new THREE.OrthographicCamera(
      -orthoSize,
      orthoSize,
      orthoSize,
      -orthoSize,
      0.1,
      100,
    );
    orthoCamera.position.set(0, 18, 0);
    orthoCamera.lookAt(0, 0, 0);

    const stereoCamera = new THREE.StereoCamera();
    stereoCamera.eyeSep = stereoSettings.eyeDistance;

    const ambient = new THREE.AmbientLight('#ffffff', 0.7);
    const keyLight = new THREE.DirectionalLight('#f8fafc', 0.7);
    keyLight.position.set(10, 10, 10);
    const rimLight = new THREE.PointLight('#93c5fd', 0.4);
    rimLight.position.set(-8, 15, -8);
    scene.add(ambient, keyLight, rimLight);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_SIZE.width * BLOCK_SIZE + 2, 0.2, BOARD_SIZE.depth * BLOCK_SIZE + 2),
      new THREE.MeshStandardMaterial({ color: '#0f172a' }),
    );
    floor.position.y = -(BOARD_SIZE.height / 2) * BLOCK_SIZE - 0.6;
    scene.add(floor);

    const blockGroup = new THREE.Group();
    scene.add(blockGroup);

    const anaglyphEffect = new AnaglyphEffect(renderer);
    anaglyphEffect.setSize(container.clientWidth, container.clientHeight);

    rendererRef.current = renderer;
    sceneRef.current = { scene, blockGroup, perspectiveCamera, orthoCamera };
    camerasRef.current = { perspectiveCamera, orthoCamera };
    anaglyphRef.current = anaglyphEffect;
    stereoRef.current = stereoCamera;

    const handleResize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      perspectiveCamera.aspect = clientWidth / clientHeight;
      perspectiveCamera.updateProjectionMatrix();
      anaglyphEffect.setSize(clientWidth, clientHeight);
    };
    window.addEventListener('resize', handleResize);

    const renderLoop = () => {
      frameRef.current = requestAnimationFrame(renderLoop);
      renderScene();
    };

    const renderScene = () => {
      if (!rendererRef.current) return;
      const view = viewRef.current;
      const { scene: activeScene, perspectiveCamera: pCamera, orthoCamera: oCamera } = sceneRef.current;
      const stereoSettingsValue = stereoSettingsRef.current;

      if (view === 'top') {
        renderer.render(activeScene, oCamera);
        return;
      }

      if (view === 'anaglyph') {
        anaglyphEffect.render(activeScene, pCamera);
        return;
      }

      if (view === 'stereo' || view === 'cross' || view === 'parallel') {
        renderStereo(view, activeScene, pCamera, stereoSettingsValue);
        return;
      }

      renderer.render(activeScene, pCamera);
    };

    const renderStereo = (mode, activeScene, baseCamera, stereoSettingsValue) => {
      const rendererInstance = rendererRef.current;
      if (!rendererInstance) return;
      baseCamera.fov = stereoSettingsValue.fov;
      baseCamera.updateProjectionMatrix();
      const stereoCameraInstance = stereoRef.current;
      stereoCameraInstance.eyeSep = stereoSettingsValue.eyeDistance * 5;
      stereoCameraInstance.focus = stereoSettingsValue.focusDepth;
      stereoCameraInstance.update(baseCamera);

      const canvas = rendererInstance.domElement;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const halfWidth = Math.floor(width / 2);
      rendererInstance.setScissorTest(true);

      const leftCam = mode === 'cross' ? stereoCameraInstance.cameraR : stereoCameraInstance.cameraL;
      const rightCam = mode === 'cross' ? stereoCameraInstance.cameraL : stereoCameraInstance.cameraR;

      rendererInstance.setScissor(0, 0, halfWidth, height);
      rendererInstance.setViewport(0, 0, halfWidth, height);
      rendererInstance.render(activeScene, leftCam);

      rendererInstance.setScissor(halfWidth, 0, halfWidth, height);
      rendererInstance.setViewport(halfWidth, 0, halfWidth, height);
      rendererInstance.render(activeScene, rightCam);

      rendererInstance.setScissorTest(false);
      rendererInstance.setViewport(0, 0, width, height);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const context = sceneRef.current;
    if (!context) return;
    buildMesh(context.blockGroup, grid, activePiece, materialCache, clearingLayers);
  }, [grid, activePiece, clearingLayers, materialCache]);

  return <div className="game-canvas" ref={containerRef} />;
}

export default GameCanvas;
