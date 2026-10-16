# Cinder para Lupa

Cuenta pestañas y ventanas, muestra el contador en el badge y exporta/importa sesiones como Markdown. La importación permite restaurar ventanas o agrupar las pestañas.

Versión de la extensión: **0.3.2**. Manifest V3, JavaScript sin paso de compilación.

## Instalar en Chromium

```sh
git clone https://github.com/bunxdev/lupa_extension_cinder.git
```

Abre `chrome://extensions`, activa el modo desarrollador y carga la carpeta del repositorio como extensión desempaquetada.

## Instalar en Lupa

En Lupa 0.0.3 con Compose slim, clona este repositorio en `deploy/slim/.runtime/extensions/cinder/` de tu instalación. En el Compose tradicional, usa `extensions/cinder/`. El archivo debe quedar en `/extensions/cinder/manifest.json` dentro del contenedor.

Lupa descubre los manifiestos al abrir un contexto de Chromium. Reabre el contexto en un momento apropiado, guardando antes el trabajo de la sesión. La descarga del repositorio no modifica las pestañas que ya están abiertas.

## Permisos y límites

- Permisos: `tabs`.
- Acceso a sitios: ninguno adicional declarado.

Importar abre pestañas y ventanas. Revisa la vista previa antes de restaurar una sesión. No guarda el contenido interno ni el estado de formularios de cada página.

## Procedencia

Consulta [PROVENANCE.md](PROVENANCE.md). Esta publicación conserva el código instalado y añade documentación de distribución; no representa una batería nueva de pruebas contra sitios externos.

Los archivos Markdown pueden abrirse con [Lumbre](https://github.com/bunxdev/lupa_extension_lumbre).

Licencia del proyecto: [MIT](LICENSE).
