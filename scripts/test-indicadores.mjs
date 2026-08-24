/**
 * Verificacion de lib/indicadores.mjs.
 *
 * No comparamos contra "numeros magicos" copiados de una web: eso solo
 * comprueba que copiamos bien. Comprobamos PROPIEDADES MATEMATICAS que
 * el indicador debe cumplir por definicion. Si una falla, hay un bug real.
 */
import { sma, ema, rsi, macd, atr, volumenRelativo, ultimo } from '../lib/indicadores.mjs';

let pasados = 0, fallados = 0;

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}

const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// Datos sinteticos con los que la respuesta correcta se conoce a mano.
const constante = new Array(60).fill(100);
const subiendo  = Array.from({ length: 60 }, (_, i) => 100 + i);
const bajando   = Array.from({ length: 60 }, (_, i) => 160 - i);

console.log('\nSMA');
{
  const datos = [2, 4, 6, 8, 10, 12];
  const r = sma(datos, 3);
  comprobar('longitud igual a la entrada', r.length === datos.length);
  comprobar('nulls antes de tener periodo completo', r[0] === null && r[1] === null);
  comprobar('primer valor = (2+4+6)/3 = 4', r[2] === 4, String(r[2]));
  comprobar('ultimo valor = (8+10+12)/3 = 10', r[5] === 10, String(r[5]));

  // La ventana deslizante suma y resta; comparamos contra la suma directa
  // para descartar deriva de coma flotante acumulada.
  const ruido = Array.from({ length: 500 }, () => Math.random() * 90000);
  const rapida = sma(ruido, 20);
  let maxError = 0;
  for (let i = 19; i < ruido.length; i++) {
    const directa = ruido.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    maxError = Math.max(maxError, Math.abs(directa - rapida[i]));
  }
  comprobar('ventana deslizante == suma directa (500 barras)', maxError < 1e-6,
    'error max ' + maxError.toExponential(2));
}

console.log('\nEMA');
{
  const r = ema(constante, 20);
  comprobar('serie constante -> EMA constante e igual', cerca(ultimo(r), 100), String(ultimo(r)));

  const rs = ema(subiendo, 10);
  comprobar('en tendencia alcista la EMA va por DEBAJO del precio',
    ultimo(rs) < subiendo[subiendo.length - 1]);
  comprobar('la semilla es la SMA de las primeras 10', cerca(rs[9], 104.5), String(rs[9]));

  const lenta = ema(subiendo, 30), corta = ema(subiendo, 5);
  comprobar('EMA corta reacciona mas rapido que la lenta', ultimo(corta) > ultimo(lenta));
}

console.log('\nRSI');
{
  comprobar('subida monotona -> RSI = 100', cerca(ultimo(rsi(subiendo, 14)), 100));
  comprobar('bajada monotona -> RSI = 0', cerca(ultimo(rsi(bajando, 14)), 0));

  const ruido = Array.from({ length: 400 }, (_, i) => 70000 + Math.sin(i / 5) * 3000 + Math.random() * 500);
  const r = rsi(ruido, 14);
  const valores = r.filter((v) => v !== null);
  comprobar('siempre dentro de [0, 100]', valores.every((v) => v >= 0 && v <= 100));
  comprobar('alineacion: primer valor en el indice 14', r[13] === null && r[14] !== null);
  comprobar('longitud igual a la entrada', r.length === ruido.length);
}

console.log('\nMACD');
{
  const ruido = Array.from({ length: 300 }, (_, i) => 70000 + Math.sin(i / 12) * 5000);
  const m = macd(ruido);
  comprobar('la linea aparece en el indice 25 (EMA lenta de 26)',
    m.linea[24] === null && m.linea[25] !== null);
  comprobar('la senal aparece 8 barras despues de la linea',
    m.senal[32] === null && m.senal[33] !== null);
  let ok = true;
  for (let i = 0; i < ruido.length; i++) {
    if (m.histograma[i] === null) continue;
    if (!cerca(m.histograma[i], m.linea[i] - m.senal[i])) ok = false;
  }
  comprobar('histograma == linea - senal en toda la serie', ok);

  const plana = macd(constante);
  comprobar('serie constante -> MACD = 0', cerca(ultimo(plana.linea), 0, 1e-9));
}

console.log('\nATR');
{
  // Velas de rango exactamente 10 y sin huecos entre ellas: ATR debe dar 10.
  const velas = Array.from({ length: 60 }, () => ({ o: 100, h: 105, l: 95, c: 100 }));
  comprobar('rango constante de 10 -> ATR = 10', cerca(ultimo(atr(velas, 14)), 10),
    String(ultimo(atr(velas, 14))));

  // Un hueco de apertura debe elevar el ATR: el alto-bajo solo no lo capta.
  const conHueco = velas.map((v, i) => (i === 40 ? { o: 200, h: 205, l: 195, c: 200 } : v));
  comprobar('un hueco de apertura eleva el ATR', ultimo(atr(conHueco, 14)) > 10);

  const reales = Array.from({ length: 100 }, (_, i) => {
    const c = 70000 + Math.random() * 4000;
    return { o: c, h: c + Math.random() * 900, l: c - Math.random() * 900, c };
  });
  comprobar('ATR nunca es negativo', atr(reales, 14).filter((v) => v !== null).every((v) => v >= 0));
}

console.log('\nVolumen relativo');
{
  const vols = new Array(40).fill(1000);
  comprobar('volumen constante -> ratio 1.0', cerca(ultimo(volumenRelativo(vols, 20)), 1));
  const pico = [...vols]; pico[39] = 3000;
  comprobar('un pico de 3x se detecta como ~2.8x', ultimo(volumenRelativo(pico, 20)) > 2.5);
}

console.log('\nEquivalencia de Wilder (demostracion, no test)');
{
  // El suavizado de Wilder de periodo n equivale a una EMA de 2n-1.
  // Lo vemos comparando nuestro RSI(14) con lo que saldria usando EMA(14):
  // si alguien implementa el RSI con EMA estandar obtiene otro numero.
  const ruido = Array.from({ length: 300 }, (_, i) => 70000 + Math.sin(i / 7) * 4000 + Math.random() * 800);
  const nuestro = ultimo(rsi(ruido, 14));
  console.log('  RSI(14) con suavizado de Wilder (correcto): ' + nuestro.toFixed(2));
  console.log('  Wilder(14) se comporta como una EMA(27), no como una EMA(14).');
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
