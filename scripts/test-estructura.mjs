/**
 * Verificacion de lib/estructura.mjs con series sinteticas cuyos pivotes
 * conocemos de antemano, porque los hemos construido nosotros.
 */
import { pivotes, estructuraMercado, nivelesClave, contextoNiveles, posicionEnRango } from '../lib/estructura.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}

/** Construye velas a partir de una lista de cierres, con rango de +-1%. */
function velasDesde(cierres) {
  return cierres.map((c, i) => ({
    o: c, h: c * 1.01, l: c * 0.99, c, v: 1000,
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
}

/**
 * Velas SIN MECHA (h = l = c). Para probar posicionEnRango necesitamos esto:
 * si la vela tiene mecha, su maximo esta por encima del cierre y la posicion
 * nunca puede llegar a 1 aunque el cierre sea el mas alto de la serie.
 * Un test que no tiene en cuenta el propio generador de datos mide otra cosa.
 */
function velasPlanas(cierres) {
  return cierres.map((c, i) => ({
    o: c, h: c, l: c, c, v: 1000,
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
}

/** Zigzag: sube `amplitud` durante `tramo` velas, luego baja, y repite. */
function zigzag(base, amplitud, tramo, ciclos) {
  const out = [];
  for (let c = 0; c < ciclos; c++) {
    for (let i = 0; i < tramo; i++) out.push(base + (amplitud * i) / tramo);
    for (let i = 0; i < tramo; i++) out.push(base + amplitud - (amplitud * i) / tramo);
  }
  return out;
}

console.log('\nPivotes');
{
  // Pico unico y claro en el centro: cierres 1..10..1
  const cierres = [10, 20, 30, 40, 50, 100, 50, 40, 30, 20, 10];
  const v = velasDesde(cierres);
  const p = pivotes(v, 3, 3);
  const altos = p.filter((x) => x.tipo === 'alto');

  comprobar('detecta exactamente un maximo', altos.length === 1, 'encontro ' + altos.length);
  comprobar('el maximo esta en el indice 5', altos[0]?.i === 5, String(altos[0]?.i));
  comprobar('confirmadoEn = indice + der = 8', altos[0]?.confirmadoEn === 8, String(altos[0]?.confirmadoEn));
  comprobar('usa el maximo (h) de la vela, no el cierre',
    Math.abs(altos[0].precio - 100 * 1.01) < 1e-9, String(altos[0]?.precio));

  // Los bordes no pueden ser pivotes: no tienen velas suficientes a un lado.
  comprobar('ningun pivote en los primeros `izq` indices', p.every((x) => x.i >= 3));
  comprobar('ningun pivote en los ultimos `der` indices', p.every((x) => x.i <= cierres.length - 4));

  // Mas confirmacion = menos pivotes, pero mas significativos.
  const zz = velasDesde(zigzag(70000, 3000, 6, 8));
  comprobar('ventana amplia detecta menos pivotes que ventana estrecha',
    pivotes(zz, 8, 8).length < pivotes(zz, 2, 2).length,
    pivotes(zz, 8, 8).length + ' vs ' + pivotes(zz, 2, 2).length);
}

console.log('\nEstructura de mercado');
{
  // Escalera alcista: cada tramo sube mas alto y corrige menos abajo.
  const alcista = [];
  for (let c = 0; c < 5; c++) {
    const base = 70000 + c * 4000;
    for (let i = 0; i < 6; i++) alcista.push(base + i * 500);
    for (let i = 0; i < 6; i++) alcista.push(base + 2500 - i * 300);
  }
  const e = estructuraMercado(pivotes(velasDesde(alcista), 4, 4));
  comprobar('escalera ascendente -> tendencia alcista', e.tendencia === 'alcista',
    e.tendencia + ' [' + e.secuenciaReciente.join(' ') + ']');
  comprobar('la secuencia solo contiene HH y HL',
    e.secuenciaReciente.every((x) => x === 'HH' || x === 'HL'), e.secuenciaReciente.join(' '));
  comprobar('el nivel de invalidacion es el ultimo minimo',
    e.nivelDeInvalidacion === e.ultimoBajo.precio);

  const bajista = alcista.map((x) => 150000 - x); // espejo exacto
  const eb = estructuraMercado(pivotes(velasDesde(bajista), 4, 4));
  comprobar('la serie espejo -> tendencia bajista', eb.tendencia === 'bajista',
    eb.tendencia + ' [' + eb.secuenciaReciente.join(' ') + ']');

  const lateral = zigzag(70000, 2000, 6, 6); // siempre entre los mismos limites
  const el = estructuraMercado(pivotes(velasDesde(lateral), 4, 4));
  comprobar('zigzag plano -> no lo llama tendencia',
    el.tendencia !== 'alcista' && el.tendencia !== 'bajista', el.tendencia);

  // REGRESION del bug encontrado: maximos identicos se etiquetaban LH, lo
  // que convertia cualquier rango lateral en "tendencia bajista".
  comprobar('maximos identicos -> EQH, no LH',
    el.secuenciaReciente.every((x) => x === 'EQH' || x === 'EQL'),
    el.secuenciaReciente.join(' '));
  comprobar('zigzag plano se identifica como rango lateral',
    el.tendencia === 'rango lateral', el.tendencia);

  // Y la tolerancia debe distinguir "casi igual" de "de verdad mas bajo".
  const casiIgual = [
    { i: 0, tipo: 'alto', precio: 77000, fecha: 'a' },
    { i: 10, tipo: 'alto', precio: 77050, fecha: 'b' },  // +0.06% -> EQH
    { i: 20, tipo: 'alto', precio: 75000, fecha: 'c' },  // -2.7%  -> LH
  ];
  const ec = estructuraMercado(casiIgual, 0.15);
  comprobar('diferencia del 0.06% se considera igualdad',
    ec.secuenciaReciente[0] === 'EQH', ec.secuenciaReciente.join(' '));
  comprobar('diferencia del 2.7% se considera maximo descendente',
    ec.secuenciaReciente[1] === 'LH', ec.secuenciaReciente.join(' '));
}

console.log('\nNiveles clave');
{
  // Zigzag plano: todos los maximos caen en el mismo precio -> UN nivel.
  const v = velasDesde(zigzag(70000, 4000, 5, 7));
  const p = pivotes(v, 3, 3);
  const atrFalso = 700;
  const n = nivelesClave(v, p, atrFalso, { toleranciaATR: 0.5 });

  comprobar('agrupa maximos repetidos en pocas zonas', n.length <= 3, 'salieron ' + n.length);
  comprobar('descarta zonas de un solo toque', n.every((x) => x.toques >= 2));
  comprobar('ordena por fuerza descendente',
    n.every((x, i) => i === 0 || n[i - 1].fuerza >= x.fuerza));
  comprobar('clasifica soporte/resistencia segun el precio actual',
    n.every((x) => (x.precio < v[v.length - 1].c ? x.tipo === 'soporte' : x.tipo === 'resistencia')));
  comprobar('la fuerza esta acotada en [0, 100]', n.every((x) => x.fuerza >= 0 && x.fuerza <= 100));

  // GRANULARIDAD. Hace falta una serie que visite las MISMAS zonas de precio
  // varias veces, con pequenas variaciones, como hace un mercado real.
  // Una escalera monotona no sirve: sus pivotes estan todos a precios
  // distintos y devolver cero zonas seria la respuesta correcta.
  const zonasBase = [70000, 75000, 70000, 75000, 70000, 75000, 80000, 75000, 80000, 75000, 80000, 70000];
  const desvio = [60, -80, 40, -50, 70, -30, 55, -65, 35, -45]; // ruido determinista
  const cierres = [];
  for (let k = 1; k < zonasBase.length; k++) {
    const desde = zonasBase[k - 1] + desvio[(k - 1) % desvio.length];
    const hasta = zonasBase[k] + desvio[k % desvio.length];
    for (let s = 0; s < 7; s++) cierres.push(desde + ((hasta - desde) * s) / 7);
  }
  const vz = cierres.map((c, i) => ({
    o: c, h: c * 1.005, l: c * 0.995, c, v: 1000,
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
  const pz = pivotes(vz, 3, 3);

  const opc = { toleranciaATR: 0.5, maxNiveles: 40, semivida: 1e9 }; // sin decaimiento
  const agrupaDemas = nivelesClave(vz, pz, 8000, opc);   // tolerancia 4000
  const equilibrado = nivelesClave(vz, pz, 400, opc);    // tolerancia 200
  const noAgrupa    = nivelesClave(vz, pz, 10, opc);     // tolerancia 5

  comprobar('tolerancia excesiva funde niveles distintos en menos zonas',
    agrupaDemas.length < equilibrado.length,
    agrupaDemas.length + ' vs ' + equilibrado.length);
  comprobar('tolerancia excesiva crea una zona con toques de niveles ajenos',
    agrupaDemas.some((n) => n.toques >= 4));
  comprobar('tolerancia diminuta no agrupa nada -> cero zonas',
    noAgrupa.length === 0, String(noAgrupa.length));
  comprobar('en el punto equilibrado aparecen las zonas reales (~70k, ~75k, ~80k)',
    [70000, 75000, 80000].every((z) =>
      equilibrado.some((n) => Math.abs(n.precio - z) < 800)),
    equilibrado.map((n) => n.precio.toFixed(0)).join(' '));
  comprobar('la relacion tolerancia/zonas NO es monotona (es una campana)',
    agrupaDemas.length > noAgrupa.length && equilibrado.length > noAgrupa.length,
    agrupaDemas.length + ' / ' + equilibrado.length + ' / ' + noAgrupa.length);
}

console.log('\nPonderacion por volumen (correccion basada en la literatura)');
{
  // Velas planas a 75.000 con volumen normal, y dos pivotes en el mismo
  // cluster: uno flojo en 74.900 y otro con volumen 8x en 75.400.
  // El nivel debe situarse cerca del toque con volumen, no en el punto medio.
  const velas = Array.from({ length: 60 }, (_, i) => ({
    o: 75000, h: 75000, l: 75000, c: 75000, v: 1000,
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
  velas[50].v = 8000; // el toque con participacion real

  const pv = [
    { i: 40, tipo: 'alto', precio: 74900, fecha: velas[40].fecha, volumen: 1000 },
    { i: 50, tipo: 'alto', precio: 75400, fecha: velas[50].fecha, volumen: 8000 },
  ];
  const [nivel] = nivelesClave(velas, pv, 2000, { toleranciaATR: 0.5, semivida: 1e9 });

  const mediaSimple = (74900 + 75400) / 2;
  comprobar('el nivel se desplaza hacia el toque de mayor volumen',
    nivel.precio > mediaSimple, nivel.precio.toFixed(0) + ' vs media simple ' + mediaSimple);
  comprobar('y no llega a superar el propio toque de mayor volumen',
    nivel.precio < 75400, nivel.precio.toFixed(0));

  // Escala logaritmica: multiplicar el volumen por 10 NO multiplica la fuerza
  // por 10. Sin log, una sola vela de capitulacion dominaria la clasificacion.
  const conPico = velas.map((v, i) => (i === 50 ? { ...v, v: 80000 } : v));
  const [nivelPico] = nivelesClave(conPico, pv, 2000, { toleranciaATR: 0.5, semivida: 1e9 });
  comprobar('el log amortigua los picos extremos de volumen',
    nivelPico.fuerza < nivel.fuerza * 3,
    nivel.fuerza + ' -> ' + nivelPico.fuerza + ' con volumen 10x mayor');
}

console.log('\nDecaimiento por semivida');
{
  const velas = Array.from({ length: 130 }, (_, i) => ({
    o: 75000, h: 75000, l: 75000, c: 75000, v: 1000,
    fecha: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
  // Dos clusters identicos en todo salvo la antiguedad: exactamente una
  // semivida de diferencia entre sus ultimos toques.
  const pv = [
    { i: 69, tipo: 'bajo', precio: 70000, fecha: velas[69].fecha, volumen: 1000 },
    { i: 79, tipo: 'bajo', precio: 70000, fecha: velas[79].fecha, volumen: 1000 },
    { i: 119, tipo: 'alto', precio: 80000, fecha: velas[119].fecha, volumen: 1000 },
    { i: 129, tipo: 'alto', precio: 80000, fecha: velas[129].fecha, volumen: 1000 },
  ];
  const n = nivelesClave(velas, pv, 2000, { toleranciaATR: 0.5, semivida: 50 });
  const antiguo = n.find((x) => x.precio === 70000);
  const reciente = n.find((x) => x.precio === 80000);

  comprobar('el nivel reciente no decae', reciente.decaimiento === 1, String(reciente.decaimiento));
  comprobar('a una semivida exacta el peso es la mitad',
    Math.abs(antiguo.decaimiento - 0.5) < 0.001, String(antiguo.decaimiento));
  comprobar('con toques y volumen iguales, la fuerza cae a la mitad',
    Math.abs(antiguo.fuerza / reciente.fuerza - 0.5) < 0.01,
    antiguo.fuerza + ' / ' + reciente.fuerza);
  comprobar('el decaimiento nunca llega a cero (exponencial, no truncado)',
    nivelesClave(velas, pv, 2000, { semivida: 5 }).every((x) => x.decaimiento > 0));
}

console.log('\nContexto: fuerza y proximidad como ejes separados');
{
  const niveles = [
    { precio: 64000, fuerza: 95, tipo: 'soporte' },      // muy fuerte pero lejos
    { precio: 76000, fuerza: 20, tipo: 'soporte' },      // debil y cerca
    { precio: 78000, fuerza: 30, tipo: 'resistencia' },  // debil y cerca
    { precio: 90000, fuerza: 88, tipo: 'resistencia' },  // muy fuerte pero lejos
  ];
  const ctx = contextoNiveles(niveles, 77000, 3);

  comprobar('la resistencia inmediata es la mas cercana, no la mas fuerte',
    ctx.resistenciaInmediata.precio === 78000, String(ctx.resistenciaInmediata.precio));
  comprobar('el soporte inmediato es el mas cercano, no el mas fuerte',
    ctx.soporteInmediato.precio === 76000, String(ctx.soporteInmediato.precio));
  comprobar('las resistencias salen ordenadas de abajo arriba',
    ctx.resistencias.every((n, i) => i === 0 || ctx.resistencias[i - 1].precio < n.precio));
  comprobar('los soportes salen ordenados de arriba abajo',
    ctx.soportes.every((n, i) => i === 0 || ctx.soportes[i - 1].precio > n.precio));
  comprobar('los niveles fuertes y lejanos no se pierden, solo se ordenan detras',
    ctx.soportes.some((n) => n.precio === 64000) && ctx.resistencias.some((n) => n.precio === 90000));

  const soloSoportes = contextoNiveles(niveles.filter((n) => n.precio < 77000), 77000, 3);
  comprobar('sin pivotes por encima se marca descubrimiento de precio',
    soloSoportes.enDescubrimiento === true);
}

console.log('\nPosicion en rango');
{
  const subiendo = velasPlanas(Array.from({ length: 80 }, (_, i) => 70000 + i * 100));
  comprobar('cerrando en maximos -> posicion = 1',
    posicionEnRango(subiendo, 60).posicion === 1,
    String(posicionEnRango(subiendo, 60).posicion));

  const bajando = velasPlanas(Array.from({ length: 80 }, (_, i) => 78000 - i * 100));
  comprobar('cerrando en minimos -> posicion = 0',
    posicionEnRango(bajando, 60).posicion === 0,
    String(posicionEnRango(bajando, 60).posicion));

  // Con mecha del 1% el cierre nunca alcanza el extremo: comprobamos que la
  // funcion sigue el maximo real (la mecha), no el cierre.
  const conMecha = velasDesde(Array.from({ length: 80 }, (_, i) => 70000 + i * 100));
  const pm = posicionEnRango(conMecha, 60).posicion;
  comprobar('con mechas el maximo del rango es la mecha, no el cierre',
    pm > 0.85 && pm < 1, String(pm));

  const plano = velasDesde(new Array(80).fill(70000));
  comprobar('serie plana -> posicion 0.5', posicionEnRango(plano, 60).posicion === 0.5);
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
