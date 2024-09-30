import { Loader } from "@googlemaps/js-api-loader"
import trackingData from "@/models/trackingModel";
import React, {useEffect, useState, useRef} from 'react';
import { DotSpinner } from "@uiball/loaders";
import TrackVisibility from 'react-on-screen';

//ROCKETSHIPIT UPS STATUS TYPES
/* 
Valid values:
D Delivered
I In Transit
M Billing Information Received
MV Billing Information Voided
P Pickup
X Exception
RS Returned to Shipper
DO Delivered Origin CFS (Freight Only)
DD Delivered Destination CFS (Freight Only)
W Warehousing (Freight Only)
NA Not Available
O Out for Delivery
*/

/*
Author: Scott Umble
Purpose: Create a google map that uses advanced markers to track our customers package.
*/

//Function responsible for transforming our data object from RocketShipIt and transform it into exactly what we need
const transformTrackingData = (data: any) => {
    return {
        pickup: data.pickup_date,
        delivered: data.delivered_time,
        estimated_delivery: data.estimated_delivery,
        destination: data.destination,
        origin: data.origin,
        activity: data.packages[0].activity
    }
}

//Component only needs the tracking number passed in this format because I'm still learning typescript
const ShipTracker = (tracking: {tracking: string})=> {

    //Loading state and tracking response data from RocketShipIt state
    const [isLoading, setLoading] = useState(true);
    const [showingHistory, setShowHistory] = useState(false);
    const [hasError, setError] = useState<string | null>(null);
    const [trackingData, setTrackingData] = useState<trackingData>({} as trackingData)

    //Google map div ref
    const googlemap = useRef<HTMLDivElement | null>(null);

    //Click handler for "showing history"
    const handleClick = () => {
        setShowHistory(!showingHistory);
    }

    //Start the process in a useEffect
    useEffect(() => {
        getTrackingInfo();
    },[])

    //Entry point for tracking. Starts with getting tracking data from rocketshipit
    //Next, creates a google map, then plots markers along the path
    const getTrackingInfo = async () => {
        try 
        {
            //Get tracking data from RocketShipIt via the tracking number
            const trackresponse = await fetch(`/api/tracking/${tracking.tracking}`, {
                method: 'GET'
            });
            const data = await trackresponse.json();

            //Transform our reponse to an object with everything we need (and to play nice with typescript)
            const transformedTrackingData = transformTrackingData(data.tracking.data);

            //Comment this out, useful for dev
            console.log("Tracking Data: ",data.tracking.data);
            
            //Set the trackingData State
            setTrackingData(transformedTrackingData);

            //Use tracking data to create the map and markers
            createMap(transformedTrackingData);
            
        } catch(e: any) {

            //If we fail to get valid data from rocketshipit, set error and end loading
            setError(e.message);
            setLoading(false);
        }
    }

    //Using the tracking data, create a google map
    const createMap = async (trackingData: trackingData) => {
        try {
        const loader = new Loader({
            apiKey: process.env.GOOGLE_API_KEY as string,
            version: "weekly"
        });
            
        let map: google.maps.Map;
        loader.load().then(async () => {
            const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
            
            map = new Map(googlemap.current as HTMLElement, {
                center: { lat: 0, lng: 0 },
                zoom: 7, 
                mapId: '4504f8b37365c3d0',
            });

            //Technically, this is where we can end the "loading", as we now have a map to display
            setLoading(false);

            //Now we'll create the markers one at a time starting at the origin and ending at the destination or current location. 
            createMarkers(trackingData,map,trackingData.activity.length, "",trackingData.origin.state);
        });
        } catch(e: any) {
            console.log("Google error: ",e.message);
        }
    }

    //Function responsible for iterating through the "activity" array in our trackingData and creating a single marker for each
    const createMarkers = async(trackingData: trackingData, gmap: google.maps.Map, counter: number, currentCity: string, currentState: string) => 
    {
        //Create our advanced marker object
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;
        try {

            //Create marker icon element
            const icon = document.createElement('img');
            icon.className = 'w-12 h-12';

            //Set default zoom, and get current map zoom
            let zoom = 7;
            if(gmap.getZoom())
                zoom = gmap.getZoom() as number;

            //Init address var
            let address = "";
            
            //If we're not currently at the final marker
            if(counter >= 0)
            {
                //Change the icon 
                icon.src = "/start.gif";

                //If this is our first marker
                if(counter >= trackingData.activity.length)
                {
                    //Start at the origin
                    address = `${trackingData.origin.city} ${trackingData.origin.state} ${trackingData.origin.postal_code}`;
                }
                else 
                {
                    //If not, find the next "unique" location (that doesn't share the same city as the activity before, this cuts down on duplicate "activity")
                    while(currentCity.toLowerCase() == trackingData.activity[counter].location.city.toLowerCase() && (trackingData.activity[counter].status_code != "OT" && trackingData.activity[counter].status_code != "D")  && counter > 0)
                        counter--;

                    //If our package has been delivered
                    if(trackingData.activity[counter].status_type == "D")
                    {
                        //End the cycle
                        counter = -1;

                        //Zoom in more
                        gmap.setZoom(13); 

                        //update icon to end icon
                        icon.src = "/end.gif";

                        //Update address to destination
                        address = `${trackingData.destination.addr1} ${trackingData.destination.city} ${trackingData.destination.state} ${trackingData.destination.postal_code}`;
                    }
                    else
                    {
                        //We only really need the state and city if we're still showing the route path
                        address = `${trackingData.activity[counter].location.city} ${trackingData.activity[counter].location.state}`;

                        //If our package is out for delivery, zoom in further
                        if(trackingData.activity[counter].status_code == "OT")
                        {
                            gmap.setZoom(10); 
                        }
                        else if(trackingData.activity[counter].location.state.toLowerCase() == currentState.toLowerCase())
                        {
                            //If the city is new, but we're still in the same state as the last activity, zoom the map in
                            //Don't set the zoom if we are already at that zoom
                            if(zoom != 7)
                                gmap.setZoom(7); 
                        }
                        else 
                        {
                            //if not, zoom out because we're moving states
                            if(zoom != 5)
                                gmap.setZoom(5); 
                        }

                        //Set our current state, city and address
                        currentState = trackingData.activity[counter].location.state.toLowerCase();
                        currentCity = trackingData.activity[counter].location.city.toLowerCase();
                    }
                }
            }
            else 
            {

                //If we reached this code, it means our package is in transit and we're at the end of our activity.
                //First, set address to destination and change the icon
                address = `${trackingData.destination.addr1} ${trackingData.destination.city} ${trackingData.destination.state} ${trackingData.destination.postal_code}`;
                icon.src = "/end.gif";

                //zoom out and show the user where the destination is in relation to our last point
                if(trackingData.destination.state.toLowerCase() == currentState.toLowerCase())
                {
                    //If our latest activity is at least in the same state as our destination, zoom out a little less
                    gmap.setZoom(5);
                }
                else
                    gmap.setZoom(3);
            }

            //Geocode the address to a lat and lng that we can create a marker with
            const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=AIzaSyDYlaJJRb8d6D96Q4w7deOAjBIoNOznJ5o`)
            const data = await response.json();
            const lat = data.results[0].geometry.location.lat; 
            const lon = data.results[0].geometry.location.lng; 

            //Pan to this lat and lng for the user
            gmap.panTo(new google.maps.LatLng(lat, lon));

            //Create marker with the lat, lng and icon
            let marker = new AdvancedMarkerElement({
                position: {lat:lat,lng:lon},
                map: gmap,
                content: icon,
            });

            //If we aren't at the end of our activity
            if(counter >= 0)
            {
                //Decrement our counter
                counter--;

                //In 1 second, start the process again with a decremeneted counter and updated current state and city
                setTimeout(createMarkers,1000,trackingData,gmap,counter, currentCity, currentState);

                //in 750ms (before we add a new marker and pan), update the marker to a checkmark instead of truck (aesthetic purposes only) (only if we're not done)
                if(counter >= 0)
                    setTimeout(updateMarker,750,marker);
            }
        }
        catch(error: any) {
            console.log("error",error.message);
        }
    }

    //Change the icon from a truck to a checkmark to give the illusion that the truck is transporting our package
    const updateMarker = (marker: google.maps.marker.AdvancedMarkerElement) => {
        const icon = document.createElement('img');
        icon.className = 'w-12 h-12';
        icon.src = "/check.gif";
        marker.content = icon;
    }

    //If the user clicks "See tracking history" show the history
    const renderHistory = () => {
        return (
            <>
            {trackingData.activity.map(activity => {
                const estdate = new Date( Date.parse(activity.time) );
                let estimate = `${estdate.getMonth() + 1}-${estdate.getDay()}-${estdate.getFullYear()} ${estdate.getUTCHours()}:${estdate.getUTCMinutes()}`;
                let key = activity.time;
                return (
                    <TrackVisibility key={key} partialVisibility once>
                    {({isVisible}) => (
                    <div className={`w-full my-8 mx-0 flex flex-row items-center justify-start text-left opacity-0 ${isVisible && "animate-fadeupquick"}`}>
                        <div className={`flex flex-row justify-start items-center`}>
                            <p className="w-32 text-slate-700">{estimate}</p>
                            <div className="flex flex-col border-l-2 pl-4">
                                <h2 className="text-slate-600">{activity.description}</h2>
                                <p className="text-slate-600">{`${activity.location.city}, ${activity.location.state}`}</p>
                            </div>
                        </div>
                    </div>)}
                    </TrackVisibility>
                )})}
            </>
        )
    }

    //Function responsible for rendering our tracker when we are done loading
    const renderTracker = () => {

        //Get the date from the most recent activity
        console.log(trackingData);
        if(!trackingData.activity)
            return;
        const date = new Date( Date.parse(trackingData.activity[0].time) );
        const formatDate = `${date.getMonth() + 1}-${date.getDay()}-${date.getFullYear()} ${date.getUTCHours()}:${date.getUTCMinutes()}`;

        //Hacky little tailwind fix to help our animations play. Must have the full animation name written our when doing dynamic animations based on variables. 
        const statusTypes = ["Label Created", "In Transit","Out for Delivery","Delivered"]
        const status = trackingData.activity[0].status_type;
        let estimate = "";
        if(trackingData.estimated_delivery.length > 0)
        {
            const estdate = new Date( Date.parse(trackingData.estimated_delivery) );
            estimate = `${estdate.getMonth() + 1}-${estdate.getDay()}-${estdate.getFullYear()} ${estdate.getUTCHours()}:${estdate.getUTCMinutes()}`;
        }
            
        let animationName = "";
        switch(status)
        {
            case "I":
                animationName = "animate-deliveryI";
                break;
            case "O":
                if(trackingData.activity[0].status_code == "OT")
                    animationName = "animate-deliveryO";
                else 
                    animationName = "animate-deliveryI";
                break;
            case "D":
                animationName = "animate-deliveryD";
                break;
        }

        return (
            <>
                <div className='w-full h-16 flex flex-row justify-start items-center relative'>
                    <span className={`w-full h-4 bg-gray-200 absolute z-1`}></span>
                    <span className={`w-full h-4 bg-blue-500 border border-gray-200 rounded-lg origin-left absolute z-2 ${animationName}`}></span>
                    <span className='absolute top-[17px] left-0 rounded-full w-8 h-8 bg-blue-500'><p className="mt-10 text-xs w-32">{statusTypes[0]}</p></span>
                    <span className={`absolute top-[17px] left-1/4 rounded-full w-8 h-8 ${animationName.length > 0  ? "bg-blue-500" : "bg-gray-200"}`}><p className="mt-10 text-xs w-32">{statusTypes[1]}</p></span>
                    <span className={`absolute top-[17px] left-3/4 rounded-full w-8 h-8 ${animationName === "animate-deliveryO" || animationName === "animate-deliveryD" ? "bg-blue-500" : "bg-gray-200"}`}><p className="mt-10 text-xs w-32">{statusTypes[2]}</p></span>
                    <span className={`absolute top-[17px] left-[97%] rounded-full w-8 h-8 ${animationName === "animate-deliveryD" ? "bg-blue-500" : "bg-gray-200"}`}><p className="mt-10 text-xs w-32">{statusTypes[3]}</p></span>
                </div>
                <div className="mt-12">
                    <h2 className="text-lg">{trackingData.activity[0].description}</h2>
                    {estimate.length > 0 && <h2 className="text-green-700 text-sm">Estimated Delivery: {estimate}</h2>}
                    <h2 className="text-slate-500 mt-4">{formatDate}</h2>
                    <p className="text-slate-500">{trackingData.activity[0].location.city}, {trackingData.activity[0].location.state}</p>
                    <button className="text-blue-500 text-sm mt-2" onClick={handleClick}>See Tracking History</button>
                </div>
                <div className={`w-full transition-all overflow-hidden ${showingHistory ? "h-auto" : "h-0"}`}>
                    {renderHistory()}
                </div>
            </>
        )
    }

    //Render
    return (
        <div className="relative">
            { hasError ? <section><h2 className="text-red-500">Tracking Error: {hasError}</h2></section>
            :
            <>
                <div id="map" className='h-80' ref={googlemap} />
                {isLoading ? 
                <div className="absolute left-[50%] top-[50%]">
                    <DotSpinner size={40} speed={0.9} color="black" />
                </div> 
                : 
                renderTracker()}
            </> }
        </div>
    )
}

//Export
export default ShipTracker;