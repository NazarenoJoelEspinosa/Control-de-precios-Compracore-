# Revisión continua de artículos faltantes

En una comparación, abrí «Encontrar los … de mi catálogo».

- La lista de tus artículos y el panel de búsqueda están visibles juntos.
- El primer pendiente se abre automáticamente.
- «Vincular y seguir» guarda la equivalencia y abre el siguiente artículo. El precio sigue pendiente de aprobación.
- «Dejar para después» aparta el artículo sin marcarlo como encontrado ni discontinuado. Recuperalo en el filtro «Para después» y usá «Volver a pendientes» si lo necesitás.
- «Anterior», «Siguiente» o Alt + flechas permiten recorrer los artículos.
- Cada artículo conserva su búsqueda. La posición y los apartados se guardan por comparación en este navegador y origen. No forman parte del backup de la base de datos.
- Se pueden buscar varias palabras y mostrar resultados adicionales de veinte en veinte. Se buscan los artículos del proveedor que siguen sin vincular, igual que en el flujo anterior.
- En escritorio cada panel tiene desplazamiento independiente. Guardar ya no reemplaza toda la pantalla por «Cargando…».

## Ejecutar

```bash
npm ci
npm run dev
```

## Validación

```bash
npm test
npm run build
```

65 pruebas correctas, incluidas diez de interacción para esta pantalla: apartar/recuperar, avance automático tras retirar un artículo, persistencia, errores y reintento, bloqueo de doble guardado, búsqueda y paginación, navegación por teclado y lista vacía.

No se pudo completar la comprobación visual en un navegador en el entorno de edición: no estaba instalado Chromium y su descarga no estuvo disponible. La compilación y las pruebas de interacción sí se ejecutaron.

## Archivos modificados

- `src/features/comparisons/ResultsPage.tsx`: actualización en segundo plano sin desmontar la pantalla e integración del nuevo panel.
- `src/features/comparisons/CatalogGapReview.tsx`: revisión continua.
- `src/features/comparisons/__tests__/CatalogGapReview.test.tsx`: pruebas de interacción.
- `package.json` y `package-lock.json`: dependencias de desarrollo del renderizador de pruebas de React.

Este ZIP contiene el proyecto fuente completo. Las dependencias se instalan con `npm ci`.

## Códigos con o sin prefijo ET-

Sólo para los proveedores donde se active la opción «Reconocer códigos con/sin ET- para este proveedor», las comparaciones nuevas reconocen `ET-ABC123` y `ABC123` en ambos sentidos. La opción está desactivada por defecto para proveedores existentes y nuevos. Se activa en Proveedores → Editar → Reconocer códigos con/sin ET- para este proveedor → Guardar cambios. La regla se aplica después del código completo y las equivalencias ya confirmadas, únicamente dentro del proveedor actual. No cambia los códigos guardados ni elimina prefijos desconocidos o letras pegadas al modelo.

Un código base único identifica el artículo. Si hay más de un candidato, queda para revisión sin elegir uno arbitrariamente. Las diferencias explícitas de presentación/cantidad, incluida xU frente a x100, también se revisan. El precio resultante de esta regla siempre queda pendiente de aprobación.

Las comparaciones anteriores no se recalculan al abrirlas: en «Encontrar productos de mi catálogo», las coincidencias con/sin ET- aparecen primero, incluso si sus descripciones no se parecen, con una etiqueta que explica la coincidencia. «Vincular y seguir» permite resolverlas sin volver a importar la lista.

Se añadieron diez pruebas del motor y de integración con IndexedDB (ambos sentidos, prioridad de códigos completos y equivalencias confirmadas, prefijos desconocidos, ceros iniciales, colisiones, rechazos, presentaciones e independencia por proveedor), y dos pruebas de interacción para las comparaciones existentes.

La misma opción controla las sugerencias en las comparaciones existentes. Ningún otro proveedor recibe esta regla automáticamente. Las pruebas verifican la activación, desactivación y la ausencia de configuración.
