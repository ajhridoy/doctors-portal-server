const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ReadConcern, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken')
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


const app = express()
const port = process.env.PORT || 5000;

app.use(cors())
app.use(express.json())

var uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-69ekxeg-shard-00-00.jh5ecod.mongodb.net:27017,ac-69ekxeg-shard-00-01.jh5ecod.mongodb.net:27017,ac-69ekxeg-shard-00-02.jh5ecod.mongodb.net:27017/?ssl=true&replicaSet=atlas-xyduq7-shard-0&authSource=admin&retryWrites=true&w=majority`;
// const uri = "mongodb+srv://newUserDb:8eozXkVEfh7lSU42@cluster0.jh5ecod.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// const uri = `mongodb+srv://newUserDb:8eozXkVEfh7lSU42@cluster0.jh5ecod.mongodb.net/?retryWrites=true&w=majority`;
// const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next){
    const authHeader = req.headers.authorization
    if(!authHeader){
        return res.status(401).send({message: 'unauthorize access'})
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(401).send({message: 'unauthorize access'})
        }
        req.decoded = decoded;
        next()
    })
}

async function run () {
    try{
        const appointmentOptionsCollections = client.db('doctorsPortal').collection('applicationOptions')

        const bookingsCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')
        const doctorsCollection = client.db('doctorsPortal').collection('doctors')
        const paymentCollection = client.db('doctorsPortal').collection('payments')
        // await client.connect()
        console.log('error')

        // make sure verify admin after verify JWT
        const verifyAdmin = async(req, res, next) => {
            const decodedEmail = req.decoded.email
            const query = {email: decodedEmail}
            const user = await usersCollection.findOne(query)
            
            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'forbidden access'})
            }
            next()
        }
        // use aggregate to query multiple collection then marge data
        app.get('/applicationOptions', async(req, res) =>{
            const date = req.query.date
            const query = {}
            const options = await appointmentOptionsCollections.find(query).toArray();

            // get the booking of the provided date
            const bookingQuery = {appointmentDate: date}
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatmentName === option.name)
                const bookSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options)
        })

        app.get('/appointmentSpecialty', async(req, res) => {
            const query = {}
            const result = await appointmentOptionsCollections.find(query).project({name: 1}).toArray();
            res.send(result)
        })
        // bookings APi
        app.get('/bookings', verifyJWT, async(req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if(email !== decodedEmail){
               return res.status(401).send({message: 'forbidden access'})
            }
            // console.log(email)
            const query = {email: email}
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings)
        })

        app.get('/bookings/:id', async(req, res) => {
            const id = req.params.id
            const query = {_id: ObjectId(id)}
            const result = await bookingsCollection.findOne(query)
            res.send(result)
        })

        app.post('/bookings', async(req, res) => {
            const booking = req.body
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatmentName: booking.treatmentName
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray()
            if(alreadyBooked.length){
                const message = `You have already booking on ${booking.appointmentDate}`;
                return res.send({acknowledged: false, message})
            }
            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        })


        app.get('/jwt', async(req, res) => {
            const email = req.query.email
            const query = {email: email}
            const user = await usersCollection.findOne(query)
            if(user){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1h'})
               return res.send({accessToken: token})
            }
            console.log(user)
           return res.status(403).send({accessToken: ''})
        })

        // stripe payment
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
          
            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: "usd",
              "payment_method_types": [
                "card"
              ]
            });
          
            res.send({
              clientSecret: paymentIntent.client_secret,
            });
          });

          app.post('/payments', async(req, res) => {
            const payment = req.body
            const result = await paymentCollection.insertOne(payment);
            const id = payment.bookingId
            const query = {_id: ObjectId(id)}
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transaction
                }
            }
            const updateResult = await bookingsCollection.updateOne(query, updatedDoc)
            res.send(result)
          })

        app.get('/users', async(req, res) => {
            const query = {}
            const users = await usersCollection.find(query).toArray()
            res.send(users)
        }) 

        app.get('/users/admin/:email', async(req, res) => {
            const email = req.params.email
            const query = {email}
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user.role === 'admin'});
        })

        app.post('/users', async(req, res) => {
            const user = req.body
            const result = await usersCollection.insertOne(user)
            res.send(result);
        }) 

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res) => {
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const options = {upsert: true};
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            console.log(result);
            res.send(result);
        })

        //temporary update price
        // app.get('/addPrice', async(req, res) => {
        //     const filter = {};
        //     const options = {upsert: true};
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionsCollections.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })

        app.get('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
            const query = {}
            const doctors = await doctorsCollection.find(query).toArray()
            res.send(doctors)
        })
        app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })
        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async(req, res) => {
            const id = req.params.id
            const filter = {_id: ObjectId(id)}
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result)
        })
    }
    finally{

    }
}

run().catch(console.log)


app.get('/', (req, res) => {
    res.send('doctors portal server was running')
})

app.listen(port, () => console.log(`server running on the port ${port}`))
module.exports = app;