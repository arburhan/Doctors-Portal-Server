const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')('sk_test_51L1X0aJ4uo6umqFGlX4zF8WfRrJoNPFilrmroV5SP8WZ6r4scj2JQXaRooHcdaClMnQS1G0BBNFEVs03i0XDVB9b00lZesQk98');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// generate random token $node
// require('crypto').randomBytes(64).toString('hex')


// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z3poc.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// jwt status func verify
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'unAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

async function run() {
    try {
        await client.connect();
        const treatmentCollection = client.db('doctors_portal').collection('treatment_schedule');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const usersCollection = client.db('doctors_portal').collection('users');
        const doctorsCollection = client.db('doctors_portal').collection('doctors');
        const paymentsCollection = client.db('doctors_portal').collection('payments');


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }
        // payment stripe api
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });

        app.get('/services', async (req, res) => {
            const query = {};
            // user project to get specific value
            const cursor = treatmentCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        });
        // all users
        app.get('/users', verifyJWT, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });
        // admin get api
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })
        // make admin api
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: "admin" },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // user collection
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            // token
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
        });

        // available tratment operation 
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
            res.send(services);

        });

        // my booking
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }
        })

        // booking api
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });
        // payment 
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        // update payment system
        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentsCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);

        })

        // load all doctors
        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find().toArray();
            res.send(doctors);
        });

        // add doctors api
        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });
        app.delete('/doctors/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })

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