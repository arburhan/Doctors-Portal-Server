const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z3poc.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();
        const treatmentCollection = client.db('doctors_portal').collection('treatment_schedule');
        const bookingCollection = client.db('doctors_portal').collection('bookings');

        app.get('/services', async (req, res) => {
            const query = {};
            const cursor = treatmentCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });

        // available: 
        app.get('/available', async (req, res) => {
            const date = req.query.date;
            // get all 
            const services = await treatmentCollection.find().toArray();
            // get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();
            // for each service, find booking for that service
            services.forEach(service => {
                //  find bookings for that service. output: [{}, {}, {}, {}]
                const serviceBookings = bookings.filter(b => b.treatment === service.name);
                //  select slots for the service Bookings: ['', '', '', '']
                const bookedSlots = serviceBookings.map(book => book.slot);
                //  select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                // set available to slots to make it easier 
                service.slots = available;
            })
            res.send(bookings);

        })

        // booking api
        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });


    }
    finally { }

}
run().catch(console.dir());



app.get('/', (req, res) => {
    res.send('Hello from doctor uncle')
})

app.listen(port, () => {
    console.log(`Doctors portal app listening on port ${port}`)
})