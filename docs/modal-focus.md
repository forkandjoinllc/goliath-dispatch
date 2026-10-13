# El foco de una ventana modal

## El defecto

Escribir **una letra** en cualquier campo de un alta rápida del tablero hacía
saltar el foco al primer campo de la ventana. Una letra, un salto. Rellenar una
carga o un conductor desde el tablero era imposible.

## Por qué pasaba

El efecto que pone el foco dependía de `[open, onClose]`:

```tsx
useEffect(() => {
  // ...pone el foco en el primer campo, engancha Escape y el tabulador...
}, [open, onClose])
```

`onClose` llega escrita **dentro** de quien pinta la ventana —`cerrar` en
`QuickAdd`— así que es otra función en cada render. Y entonces:

1. se teclea una letra,
2. cambia el estado del formulario,
3. se vuelve a pintar,
4. nace un `onClose` nuevo,
5. React ve una dependencia distinta: **limpia el efecto y lo vuelve a montar**,
6. y lo primero que hace el efecto al montarse es poner el foco en el primer
   campo.

**El efecto hacía exactamente lo que su comentario decía.** Lo que no era cierto
era «al abrirse»: se abría treinta veces mientras alguien escribía una ciudad.

## El arreglo

`onClose` vive en una referencia que se pone al día en su propio efecto, y el
efecto del foco depende solo de `open`:

```tsx
const cerrar = useRef(onClose)

useEffect(() => {
  cerrar.current = onClose
}, [onClose])

useEffect(() => {
  // ...y aquí dentro se llama `cerrar.current()`...
}, [open])
```

La referencia se escribe **en un efecto y no durante el render**: escribir en
una referencia mientras se pinta es escribir fuera de tiempo — en modo
concurrente React puede pintar sin llegar a usar ese resultado, y la referencia
se quedaría con una función de un render que no existió.

### Por qué no se arregló en quien llama

La otra salida era pedirle a cada pantalla que envolviera su `onClose` en
`useCallback`. Eso es un contrato que no se ve: funciona hasta que alguien
escribe la cuarta ventana sin enterarse, y el defecto reaparece en otra
pantalla. **Una ventana tiene que aguantar que le pasen una función nueva en
cada render**, porque es lo normal en React.

## Lo que se vigila

La suite de este producto es de servidor: no hay nada que monte un componente
de React y escriba en él. Lo que sí se puede sujetar es **la forma** que causa
el defecto, y se sujeta en toda la aplicación:

- el efecto del foco depende solo de `open`;
- `onClose` se lee por referencia y no por cierre;
- la referencia se actualiza en un efecto;
- **ningún efecto con limpieza, en ningún fichero, depende de una prop `onAlgo`**.

Ese último es el que importa: una prop que se llama `onAlgo` es por convención
una función que escribe el padre, casi nunca memorizada. Metida en un array de
dependencias, el efecto se desmonta y se vuelve a montar en cada render del
padre. Si mueve el foco, lo roba; si abre una conexión, la reabre; si arranca un
reloj, lo reinicia.

El efecto de una línea que pone la referencia al día **sí** depende de
`onClose`, y está bien: no tiene limpieza, así que volver a montarlo no le hace
daño a nadie. Por eso el guardián mira solo los efectos con limpieza.

## De paso: el cuarto menú

`useMenu` hace tres cosas —cierra al pulsar fuera, cierra con Escape y
**devuelve el foco al botón**— y su comentario avisaba de que «un cuarto menú
escrito a mano acabaría haciendo dos de las tres». El menú de los tres puntos
del panel de la carga era ese cuarto: cerraba de las dos maneras y no devolvía
el foco, así que quien lo cerraba con el teclado se quedaba con el foco en el
`<body>`.

Ahora usa el gancho, y un guardián comprueba que **ningún fichero fuera de
`lib/useMenu` y `Modal` escucha el ratón o el teclado por su cuenta**.

---

Ver también: [board-panels.md](board-panels.md) · [testing.md](testing.md)
