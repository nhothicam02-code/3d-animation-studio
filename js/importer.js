export function bindImporters({ modelInput, environmentInput, onModel, onEnvironment, viewport, onError }) {
  modelInput.addEventListener('change', async event => {
    const files = [...event.target.files];
    for (const file of files) {
      try { await onModel(file); } catch (error) { onError(error); }
    }
    modelInput.value = '';
  });
  environmentInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) {
      try { await onEnvironment(file); } catch (error) { onError(error); }
    }
    environmentInput.value = '';
  });
  const overlay = document.getElementById('dropOverlay');
  ['dragenter', 'dragover'].forEach(name => viewport.addEventListener(name, event => {
    event.preventDefault(); overlay.classList.add('show');
  }));
  ['dragleave', 'drop'].forEach(name => viewport.addEventListener(name, event => {
    event.preventDefault(); overlay.classList.remove('show');
  }));
  viewport.addEventListener('drop', async event => {
    for (const file of [...(event.dataTransfer?.files || [])]) {
      if (/\.(glb|gltf|fbx)$/i.test(file.name)) {
        try { await onModel(file); } catch (error) { onError(error); }
      }
    }
  });
}