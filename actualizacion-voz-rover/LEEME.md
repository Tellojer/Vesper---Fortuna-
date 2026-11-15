# Actualización: sistema de voz, transitabilidad de rover y referencias

Copia de los 11 archivos nuevos o modificados en esta actualización, con la misma ruta que tienen
dentro de `frontend/`. La app usa los de `frontend/`; esta carpeta es solo para revisarlos y
organizarlos, y se puede borrar sin afectar nada.

| Archivo | Estado | Contenido |
|---|---|---|
| `src/voice/intent.ts` | nuevo | Entiende fecha, hora y región de la petición (voz o texto) |
| `src/backend/rover.ts` | nuevo | Transitabilidad, rugosidad y límites de rovers (NASA) |
| `REFERENCES.md` | nuevo | Fuentes de datos, citas y archivos por función |
| `src/components/VesperBubble.tsx` | modificado | Diálogo del asistente de voz en la burbuja |
| `src/components/VesperBubble.css` | modificado | Estilos del diálogo |
| `src/components/SitePanel.tsx` | modificado | Sección "Rover traversability" en la pestaña Terrain |
| `src/backend/recommend.ts` | modificado | Mejor sitio recomendado de una región |
| `src/state/store.ts` | modificado | Límite de pendiente del rover |
| `src/styles/app.css` | modificado | Estilos de la sección del rover |
| `tests/main-interface.spec.ts` | modificado | Pruebas de voz y rover |
| `HANDOFF.md` | modificado | Documentación del proyecto |
