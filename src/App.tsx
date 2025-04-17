import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';

// Define types for airports and routes
type AirportCode = 'KLAX' | 'KBOS' | 'KJFK' | 'EGLL' | 'EDDF' | 'LFPG' | 'YSSY' | 'RJTT' | 'EHAM' | 'WSSS' | 'OMDB';

interface Airport {
  name: string;
  coordinates: [number, number];
}

interface FlightRoute {
  origin: AirportCode;
  destination: AirportCode;
}

// Airport data
const airports: Record<AirportCode, Airport> = {
  'KLAX': { name: 'Los Angeles (LAX)', coordinates: [33.9425, -118.4081] },
  'KBOS': { name: 'Boston (BOS)', coordinates: [42.3644, -71.0052] },
  'KJFK': { name: 'New York JFK', coordinates: [40.6413, -73.7781] },
  'EGLL': { name: 'London Heathrow', coordinates: [51.4700, -0.4543] },
  'EDDF': { name: 'Frankfurt', coordinates: [50.0379, 8.5622] },
  'LFPG': { name: 'Paris Charles de Gaulle', coordinates: [49.0097, 2.5478] },
  'YSSY': { name: 'Sydney', coordinates: [-33.9461, 151.1772] },
  'RJTT': { name: 'Tokyo Haneda', coordinates: [35.5494, 139.7798] },
  'EHAM': { name: 'Amsterdam', coordinates: [52.3086, 4.7639] },
  'WSSS': { name: 'Singapore', coordinates: [1.3502, 103.9940] },
  'OMDB': { name: 'Dubai', coordinates: [25.2528, 55.3644] }
};

// Flight routes data
const flightRoutes: Record<string, FlightRoute> = {
  'UAL2402': { origin: 'KLAX', destination: 'KBOS' },
  'AAL100': { origin: 'KJFK', destination: 'EGLL' },
  'BAW283': { origin: 'EGLL', destination: 'KLAX' },
  'DLH400': { origin: 'EDDF', destination: 'KJFK' },
  'AFR66': { origin: 'LFPG', destination: 'KLAX' },
  'QFA11': { origin: 'YSSY', destination: 'KLAX' },
  'ANA12': { origin: 'RJTT', destination: 'KLAX' },
  'KLM601': { origin: 'EHAM', destination: 'KLAX' },
  'SIA12': { origin: 'WSSS', destination: 'KLAX' },
  'EMIR215': { origin: 'OMDB', destination: 'KLAX' }
};

// List of flights to track
const trackedFlights = Object.keys(flightRoutes);

interface FlightData {
  icao24: string;
  callsign: string;
  origin_country: string;
  longitude: number;
  latitude: number;
  baro_altitude: number;
  velocity: number;
  true_track: number;
}

// Function to calculate distance between two points
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Function to find the closest point on a line segment
const findClosestPointOnLine = (
  pointLat: number,
  pointLon: number,
  lineStartLat: number,
  lineStartLon: number,
  lineEndLat: number,
  lineEndLon: number
): [number, number] => {
  const A = pointLat - lineStartLat;
  const B = pointLon - lineStartLon;
  const C = lineEndLat - lineStartLat;
  const D = lineEndLon - lineStartLon;

  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  
  if (len_sq !== 0) {
    param = dot / len_sq;
  }

  let xx, yy;

  if (param < 0) {
    xx = lineStartLat;
    yy = lineStartLon;
  } else if (param > 1) {
    xx = lineEndLat;
    yy = lineEndLon;
  } else {
    xx = lineStartLat + param * C;
    yy = lineStartLon + param * D;
  }

  return [xx, yy];
};

// Function to calculate bearing between two points
const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const λ1 = lon1 * Math.PI / 180;
  const λ2 = lon2 * Math.PI / 180;

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);

  return (θ * 180 / Math.PI + 360) % 360;
};

function App() {
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [loading, setLoading] = useState(true);

  // Function to create a rotated plane icon
  const createPlaneIcon = (heading: number) => {
    return new L.DivIcon({
      html: `<div style="transform: rotate(${heading}deg); font-size: 30px; display: flex; justify-content: center; align-items: center;">✈️</div>`,
      className: 'plane-icon',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  };

  useEffect(() => {
    const fetchFlights = async () => {
      try {
        setLoading(true);
        const response = await axios.get('https://opensky-network.org/api/states/all');
        
        if (response.data && response.data.states) {
          const flightsList: FlightData[] = response.data.states
            .map((state: any) => ({
              icao24: state[0] || '',
              callsign: state[1] || '',
              origin_country: state[2] || '',
              longitude: state[5] || 0,
              latitude: state[6] || 0,
              baro_altitude: state[7] || 0,
              velocity: state[9] || 0,
              true_track: state[10] || 0,
            }))
            .filter((flight: FlightData) => 
              trackedFlights.some(trackedFlight => 
                flight.callsign.includes(trackedFlight)
              )
            );

          setFlights(flightsList);
        }
      } catch (error) {
        console.error('Error fetching flight data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFlights();
    const interval = setInterval(fetchFlights, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="App" style={{ height: '100vh', width: '100vw' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 1000,
          background: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 0 10px rgba(0,0,0,0.2)'
        }}>
          Loading flight data...
        </div>
      )}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: 1000,
        background: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 0 10px rgba(0,0,0,0.2)'
      }}>
        <h3>Tracked Flights</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {trackedFlights.map(flight => (
            <li key={flight}>{flight}</li>
          ))}
        </ul>
      </div>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        maxBounds={[[-90, -180], [90, 180]]}
        maxBoundsViscosity={1.0}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          noWrap={true}
        />
        
        {/* Draw flight routes */}
        {Object.entries(flightRoutes).map(([flightId, route]) => {
          const origin = airports[route.origin];
          const destination = airports[route.destination];
          
          return (
            <React.Fragment key={flightId}>
              {/* Draw yellow route line */}
              <Polyline
                positions={[
                  [origin.coordinates[0], origin.coordinates[1]],
                  [destination.coordinates[0], destination.coordinates[1]]
                ]}
                color="yellow"
                weight={3}
                opacity={0.7}
              />
              
              {/* Origin airport marker */}
              <Marker position={[origin.coordinates[0], origin.coordinates[1]]}>
                <Popup>
                  <div style={{ fontWeight: 'bold' }}>{origin.name}</div>
                </Popup>
              </Marker>
              
              {/* Destination airport marker */}
              <Marker position={[destination.coordinates[0], destination.coordinates[1]]}>
                <Popup>
                  <div style={{ fontWeight: 'bold' }}>{destination.name}</div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
        
        {/* Show planes along the routes */}
        {flights.map((flight) => {
          const flightId = trackedFlights.find(trackedFlight => 
            flight.callsign.includes(trackedFlight)
          );
          
          if (flightId && flightRoutes[flightId]) {
            const route = flightRoutes[flightId];
            const origin = airports[route.origin];
            const destination = airports[route.destination];
            
            // Find the closest point on the route line to the actual flight position
            const [closestLat, closestLon] = findClosestPointOnLine(
              flight.latitude,
              flight.longitude,
              origin.coordinates[0],
              origin.coordinates[1],
              destination.coordinates[0],
              destination.coordinates[1]
            );
            
            // Calculate the bearing from the current position to the destination
            const bearing = calculateBearing(
              closestLat,
              closestLon,
              destination.coordinates[0],
              destination.coordinates[1]
            );
            
            return (
              <Marker
                key={flight.icao24}
                position={[closestLat, closestLon]}
                icon={createPlaneIcon(bearing)}
              >
                <Popup>
                  <div>
                    <strong>Flight:</strong> {flight.callsign}<br />
                    <strong>From:</strong> {origin.name}<br />
                    <strong>To:</strong> {destination.name}<br />
                    <strong>Altitude:</strong> {Math.round(flight.baro_altitude * 3.28084)} ft<br />
                    <strong>Speed:</strong> {Math.round(flight.velocity * 1.94384)} knots
                  </div>
                </Popup>
              </Marker>
            );
          }
          return null;
        })}
      </MapContainer>
    </div>
  );
}

export default App;
