export interface Coordenada {
  lat: number;
  lng: number;
  nombre: string;
}

export const aeropuertosDB: Record<string, Coordenada> = {
  // América del Sur
  "SKBO": { lat: 4.7014, lng: -74.1469, nombre: "Bogotá (Colombia)" },
  "SEQM": { lat: 0.1133, lng: -78.3586, nombre: "Quito (Ecuador)" },
  "SVMI": { lat: 10.6031, lng: -66.9906, nombre: "Caracas (Venezuela)" },
  "SBBR": { lat: -15.8647, lng: -47.9181, nombre: "Brasilia (Brasil)" },
  "SPIM": { lat: -12.0219, lng: -77.1144, nombre: "Lima (Perú)" },
  "SLLP": { lat: -16.5131, lng: -68.1922, nombre: "La Paz (Bolivia)" },
  "SCEL": { lat: -33.3964, lng: -70.7947, nombre: "Santiago (Chile)" },
  "SABE": { lat: -34.5592, lng: -58.4156, nombre: "Buenos Aires (Argentina)" },
  "SGAS": { lat: -25.2400, lng: -57.5200, nombre: "Asunción (Paraguay)" },
  "SUAA": { lat: -34.7892, lng: -56.2647, nombre: "Montevideo (Uruguay)" },

  // Europa
  "LATI": { lat: 41.4147, lng: 19.7206, nombre: "Tirana (Albania)" },
  "EDDI": { lat: 52.4736, lng: 13.4017, nombre: "Berlín (Alemania)" },
  "LOWW": { lat: 48.1108, lng: 16.5708, nombre: "Viena (Austria)" },
  "EBCI": { lat: 50.4592, lng: 4.4536, nombre: "Bruselas (Bélgica)" },
  "UMMS": { lat: 53.8825, lng: 28.0325, nombre: "Minsk (Bielorrusia)" },
  "LBSF": { lat: 42.6903, lng: 23.4047, nombre: "Sofía (Bulgaria)" },
  "LKPR": { lat: 50.1014, lng: 14.2656, nombre: "Praga (Rep. Checa)" },
  "LDZA": { lat: 45.7428, lng: 16.0686, nombre: "Zagreb (Croacia)" },
  "EKCH": { lat: 55.6181, lng: 12.6561, nombre: "Copenhague (Dinamarca)" },
  "EHAM": { lat: 52.3000, lng: 4.7650, nombre: "Ámsterdam (Holanda)" },

  // Asia
  "VIDP": { lat: 28.5664, lng: 77.1031, nombre: "Delhi (India)" },
  "OSDI": { lat: 33.4114, lng: 36.5156, nombre: "Damasco (Siria)" },
  "OERK": { lat: 24.9578, lng: 46.6989, nombre: "Riad (Arabia Saudita)" },
  "OMDB": { lat: 25.2528, lng: 55.3644, nombre: "Dubái (Emiratos A.U.)" },
  "OAKB": { lat: 34.5656, lng: 69.2108, nombre: "Kabul (Afganistán)" },
  "OOMS": { lat: 23.5894, lng: 58.2842, nombre: "Mascate (Omán)" },
  "OYSN": { lat: 15.4761, lng: 44.2197, nombre: "Saná (Yemen)" },
  "OPKC": { lat: 24.9000, lng: 67.1500, nombre: "Karachi (Pakistán)" },
  "UBBB": { lat: 40.4672, lng: 50.0467, nombre: "Bakú (Azerbaiyán)" },
  "OJAI": { lat: 31.7225, lng: 35.9933, nombre: "Amán (Jordania)" }
};