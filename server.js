const express = require("express");
const cors = require("cors");
const app = express();

app.use('/static', express.static('static'));
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory storage for now
let flightBookings = [];
let nextId = 1;

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Create booking
app.post("/api/flight-bookings", (req, res) => {
  const {
    pilotId,
    aircraftId,
    departureAirport,
    arrivalAirport,
    plannedDepartureTime,
    plannedArrivalTime,
    passengers,
    remarks
  } = req.body;

  if (!pilotId || !aircraftId || !departureAirport || !arrivalAirport || !plannedDepartureTime || !plannedArrivalTime) {
    return res.status(400).json({
      error: "Missing required fields"
    });
  }

  const booking = {
    id: nextId++,
    pilotId,
    aircraftId,
    departureAirport,
    arrivalAirport,
    plannedDepartureTime,
    plannedArrivalTime,
    actualDepartureTime: null,
    actualArrivalTime: null,
    passengers: passengers || 0,
    remarks: remarks || "",
    status: "submitted",
    atcDecisionComment: "",
    completionNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  flightBookings.push(booking);
  res.status(201).json(booking);
});

// List all bookings
app.get("/api/flight-bookings", (req, res) => {
  const { status } = req.query;

  if (status) {
    const filtered = flightBookings.filter(
      b => b.status.toLowerCase() === String(status).toLowerCase()
    );
    return res.json(filtered);
  }

  res.json(flightBookings);
});

// Get one booking
app.get("/api/flight-bookings/:id", (req, res) => {
  const booking = flightBookings.find(b => b.id === Number(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  res.json(booking);
});

// ATC review: approve / deny / needs_changes
app.patch("/api/flight-bookings/:id/review", (req, res) => {
  const booking = flightBookings.find(b => b.id === Number(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const { status, comment } = req.body;

  const allowedStatuses = ["approved", "denied", "needs_changes"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: "Status must be approved, denied, or needs_changes"
    });
  }

  booking.status = status;
  booking.atcDecisionComment = comment || "";
  booking.updatedAt = new Date().toISOString();

  res.json(booking);
});

// Mark flight completed and add actual times
app.patch("/api/flight-bookings/:id/complete", (req, res) => {
  const booking = flightBookings.find(b => b.id === Number(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const {
    actualDepartureTime,
    actualArrivalTime,
    completionNotes
  } = req.body;

  booking.status = "completed";
  booking.actualDepartureTime = actualDepartureTime || null;
  booking.actualArrivalTime = actualArrivalTime || null;
  booking.completionNotes = completionNotes || "";
  booking.updatedAt = new Date().toISOString();

  res.json(booking);
});

app.listen(PORT, () => {
  console.log(`SkyCommand API running on port ${PORT}`);
});