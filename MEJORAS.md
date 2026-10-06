# Correcciones de precios, claridad y diseño

## Conservado

Los códigos exactos y normalizados siguen identificando el producto automáticamente, aunque difiera la presentación. No se agregan sugerencias por esa diferencia. Las firmas existentes y los registros anteriores de IndexedDB se conservan; los campos nuevos son opcionales. No hay importación automática a OneSoft.

## Precios y moneda

- Se rechazan textos como «Consultar 123» en vez de extraer sus números.
- La coma se interpreta como decimal, también con tres o más decimales: 18,455 → 18,46.
- Se admiten miles agrupados: 1.234.567 → 1234567. El punto único con tres dígitos conserva la interpretación de miles: 1.500 → 1500. La ambigüedad de formatos mixtos debe revisarse antes de importar.
- Los separadores mal agrupados y números no finitos se rechazan. El redondeo evita el error binario de 18.455.
- La importación, alta y edición del catálogo usan la misma lectura de precios. Las filas inválidas se muestran y bloquean la importación, sin convertir errores en cero.
- La importación del catálogo admite columna de moneda y moneda alternativa seleccionable; el artículo permite editar su moneda.
- La comparación usa moneda mapeada o predeterminada del proveedor. Monedas distintas o desconocidas muestran un aviso y no generan cambios de precio. No se calcula tipo de cambio ni IVA.

## Identificación y aprobación

Confirmar identidad o guardar presentaciones deja precios pendientes. En Configuración, «Aprobar precios de códigos coincidentes» controla la aprobación de precios válidos de códigos exactos/normalizados; está activada por defecto para conservar ese flujo. Desactivarla no genera sugerencias ni vuelve dudosa la identidad del artículo.

Resultados distingue producto identificado, precio pendiente, aprobado, rechazado y error de precio/moneda. Hay filtros para esos casos y un botón para aprobar todos los pendientes del filtro actual. La aprobación por lote y su recálculo de estadísticas se guardan en una sola transacción. Los rechazados desaparecen de Subieron/Bajaron y de sus estadísticas.

## Configuración y diccionario

El máximo de candidatos y las opciones de búsqueda por familia y descripción se aplican al motor. Los cambios de configuración afectan las próximas comparaciones. La memoria de columnas por proveedor sigue funcionando.

El diccionario distingue relaciones específicas por artículo y reglas generales de presentación. Estas reglas ahora son operativas: coinciden patrones literales con límites de palabra, sin confundir x1000 con x10000. Se pueden editar y activar/desactivar. Las cantidades específicas tienen prioridad. Las reglas contradictorias bloquean el precio con un aviso. Los códigos discontinuados se pueden volver a habilitar.

La relación por artículo se modifica desde Revisar detalle para recalcular la comparación actual. Editar reglas generales cambia próximas listas, sin reescribir resultados históricos.

## Diseño y estructura

- Menú plegable en pantallas pequeñas y márgenes adaptables.
- Tablas con desplazamiento en resultados, catálogo, historial, diccionario y vista previa de importación; encabezado fijo en la tabla de resultados.
- Mayor contraste para avisos y textos auxiliares.
- Detalle con cierre por Escape, etiquetas accesibles y devolución de foco.
- Cantidades y divisor de la conversión visibles.
- Resumen aclara que usa las últimas diez comparaciones y separa filas proveedor de artículos propios.
- Cálculo central de estadísticas y validación de precio/moneda reutilizados por comparación y decisiones.
- Formularios de configuración y diccionario separados y escritos de forma legible.
- Lectura XLSX y exportación Excel se cargan cuando se necesitan. JavaScript inicial aproximado: de 1,59 MB a 325 KB sin comprimir. El módulo de exportación sigue siendo grande, pero ya no se carga al abrir la app.

## Excel y pruebas

El Excel conserva códigos, precios y estados y agrega monedas, aviso de precio, conversión y precio original del proveedor. «Exportar sólo aprobados» excluye pendientes, rechazados, precios sin cambio y precios con error.

Validación: npm test (45 pruebas), npm run build y lectura de archivos XLSX generados en pruebas. Se cubren códigos coincidentes conservados, configuraciones, límites de candidatos, monedas, formatos numéricos, reglas, decisiones, backups y exportaciones.

La comprobación visual en navegador está pendiente: no estuvo disponible el navegador de prueba del entorno. Conviene usar primero una lista pequeña y comprobar menús, filtros, precios y Excel en el navegador habitual.

## Ejecutar

```sh
npm ci
npm test
npm run dev
```
