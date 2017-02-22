import request from "request";

const YELP_APP_ID = process.env.YELP_ID; 
const YELP_APP_SECRET = process.env.YELP_SECRET; 

const YELP_API = 'https://api.yelp.com';
const YELP_OAUTH = 'oauth2/token';
const YELP_SEARCH = 'v3/businesses/search'

const authenticate = (callback) => {
  const authenticationOptions = {
    "method": "POST",
    "url": `${YELP_API}/${YELP_OAUTH}`,
    "form": {
      "grant_type": "client_credentials",
      "client_id": YELP_APP_ID,
      "client_secret": YELP_APP_SECRET
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

export const searchYelp = (zip, callback) => {
  authenticate( token => {
    const requestOptions = {
      "method": "GET",
      "headers": {
        "Authorization": `Bearer ${token}`
      },
      "url": `${YELP_API}/${YELP_SEARCH}`,
      "qs": {
        "location": zip,
        "term": "food",
        "limit": 5
      }
    };

    request(requestOptions, (err, response, body) => {
      callback(JSON.parse(body));
    });
  });
};
