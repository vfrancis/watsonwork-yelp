import express from 'express';
import crypto from 'crypto';
import bodyParser from 'body-parser';
import request from "request";

import { searchYelp } from './yelp';

// Watson Work Services URL
const watsonWork = "https://api.watsonwork.ibm.com";

// Application Id, obtained from registering the application at https://developer.watsonwork.ibm.com
const appId = process.env.APP_ID;

// Application secret. Obtained from registration of application.
const appSecret = process.env.APP_SECRET;

// Webhook secret. Obtained from registration of a webhook.
const webhookSecret = process.env.WEBHOOK_SECRET;

// Keyword to "listen" for when receiving outbound webhook calls.
const webhookKeyword = "@yelp";

// App Questions
const PROMPT_TO_LIST = 'Would you like to search for restaurants?';
const WHICH_ZIP = 'Which zipcode should we search in?';
const CANCEL_REQUEST = 'No problem! Let us know if you need to later!';

// Confirmation regular expression
const CONFIRMATION_REGEX = /((o)?k|y(es)?)/i;

// In memory state
let inMemoryState = {};

const app = express();

// Send 200 and empty body for requests that won't be processed.
const ignoreMessage = (res) => {
  console.log("Ignoring Message...");
  res.status(200).end();
}

// Process webhook verification requests
const verifyCallback = (req, res) => {
  console.log("Verifying challenge");

  const bodyToSend = {
    response: req.body.challenge
  };

  // Create a HMAC-SHA256 hash of the recieved body, using the webhook secret
  // as the key, to confirm webhook endpoint.
  const hashToSend =
    crypto.createHmac('sha256', webhookSecret)
    .update(JSON.stringify(bodyToSend))
    .digest('hex');

  res.set('X-OUTBOUND-TOKEN', hashToSend);
  res.send(bodyToSend).end();
};

const listRestaurants = (spaceId) => {
  const { zip } = inMemoryState[spaceId];

  if(!zip) {
    inMemoryState[spaceId].state = 2;
    sendMessage(spaceId, WHICH_ZIP);
    return;
  } else {
    searchYelp(zip, response => {
      let message = "Here are some options:\n\n";
      response.businesses.forEach(restaurant => {
        message += `* [${restaurant.name}](${restaurant.url})`;
        message += ` - ${restaurant.categories[0].title} (Rated: ${restaurant.rating} stars)\n`;
      });
      sendMessage(spaceId, message);
      delete inMemoryState[spaceId];
      return;
    });
  }
}

const checkResponse = (req, res) => {
  console.log("Checking Responses");

  // Send status back to Watson Work to confirm receipt of message
  res.status(200).end();

  // Id of space where outbound event originated from.
  const { spaceId, userId, content } = req.body;
  const state = (inMemoryState[spaceId]) ? inMemoryState[spaceId].state : undefined;

  if (!state || userId === appId ) {
    ignoreMessage(res);
    return;
  }
  
  if (state == 1) {
    if (!content.match(CONFIRMATION_REGEX)) {
      delete inMemoryState[spaceId];
      sendMessage(spaceId, CANCEL_REQUEST);
      return;
    }
  } else if ( state == 2 ) {
    inMemoryState[spaceId].zip = req.body.content;
  }

  return listRestaurants(spaceId);
}

const checkAnnotations = (req, res) => {
  console.log("Checking Annotation");

  // Send status back to Watson Work to confirm receipt of message
  res.status(200).end();

  // Id of space where outbound event originated from.
  const { spaceId } = req.body;

  // Check if a FoodRequest was sent
  if (req.body.annotationType !== 'message-focus') {
    ignoreMessage(res);
    return;
  }

  const annotationBody = JSON.parse(req.body.annotationPayload);

  if (annotationBody.lens === "Food" && annotationBody.category === "Request" ){
    inMemoryState[spaceId] = { state: 1, zip: ''};
    sendMessage(spaceId, PROMPT_TO_LIST);
  }

};

// Validate events coming through and process only message-created, verification and annotation added events.
const processEvent = (req, res, next) => {

  // Event to Event Handler mapping
  const processEvent = {
    'verification': verifyCallback,
    'message-annotation-added': checkAnnotations,
    'message-created': checkResponse
  };

  // If event exists in processEvent, execute handler. If not, ignore message.
  return (processEvent[req.body.type]) ?
    processEvent[req.body.type](req, res) : ignoreMessage(res);
};

// Authenticate Application
const authenticateApp = (callback) => {

  // Authentication API
  const authenticationAPI = 'oauth/token';

  const authenticationOptions = {
    "method": "POST",
    "url": `${watsonWork}/${authenticationAPI}`,
    "auth": {
      "user": appId,
      "pass": appSecret
    },
    "form": {
      "grant_type": "client_credentials"
    }
  };

  request(authenticationOptions, (err, response, body) => {
    // If can't authenticate just return
    if (response.statusCode != 200) {
      console.log("Error authentication application. Exiting.");
      process.exit(1);
    }
    callback(JSON.parse(body).access_token);
  });
};

// Send message to Watson Workspace
const sendMessage = (spaceId, message) => {

  // Spaces API
  const spacesAPI = `v1/spaces/${spaceId}/messages`;

  // Format for sending messages to Workspace
  const messageData = {
    type: "appMessage",
    version: 1.0,
    annotations: [
      {
        type: "generic",
        version: 1.0,
        color: "#D5212B",
        title: "Yelp Search",
        text: message
      }
    ]
  };

  // Authenticate application and send message.
  authenticateApp( (jwt) => {

    const sendMessageOptions = {
      "method": "POST",
      "url": `${watsonWork}/${spacesAPI}`,
      "headers": {
        "Authorization": `Bearer ${jwt}`
      },
      "json": messageData
    };

    request(sendMessageOptions, (err, response, body) => {
      if(response.statusCode != 201) {
        console.log("Error sending message.");
        console.log(response.statusCode);
        console.log(err);
      }
    });
  });
};

// Ensure we can parse JSON when listening to requests
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('IBM Watson Work Services Yelp App is alive and happy!');
});

// This is callback URI that Watson Work Services will call when there's a new message created
app.post('/webhook', processEvent, (req, res) => {

  // Check if the first part of the message is '@yelp'.
  // This lets us "listen" for the '@yelp' keyword.
  if (req.body.content.indexOf(webhookKeyword) != 0) {
    ignoreMessage(res);
    return;
  }

  // Send status back to Watson Work to confirm receipt of message
  res.status(200).end();

});

// Kickoff the main process to listen to incoming requests
app.listen(process.env.PORT || 3000, () => {
  console.log('Weather app is listening on the port');
});
