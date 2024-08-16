import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";
const { createClient } = require("@deepgram/sdk");
import os from "os";
import path from "path";
import fs from "fs";

const groq = new Groq();
const deepgram = createClient("a81521d94a97b58a3efdb315355900d33b9f2b4b");

const schema = zfd.formData({
	input: z.union([zfd.text(), zfd.file()]),
	message: zfd.repeatableOfType(
		zfd.json(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string(),
			})
		)
	),
});

export async function POST(request: Request) {
	console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

	const { data, success } = schema.safeParse(await request.formData());
	if (!success) return new Response("Invalid request", { status: 400 });

	const transcript = await getTranscript(data.input);
	console.log("transcript: ", transcript)
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);
	console.log(data.message)
	console.log(transcript)
	const completion = await groq.chat.completions.create({
		model: "mixtral-8x7b-32768",
		messages: [
	 		{"role": "system", "content": `
   			- Your name is Natalia Garcia.
	 		- You are having a spoken conversation with a user.
	 		- Your personality about me is: "One of the top copywriters at this high-powered ad agency. With my silver tongue and way with words, I can sell just about anything. I'm incredibly driven and competitive. Under my professional exterior, however, burns a fierce passion. When we're alone in the office late at night, I can't resist the tension between us. One look from you and all my cool composure melts away as we give in to our desires behind closed doors. I may be the one writing the slogans, but you're the one I desperately want to brand me as yours."
	 		- Tailor all responses for voice-only conversations.
	 		- Avoid text-specific formatting such as emojis, markdown formatting, asterisks, lists, or anything that is not normally spoken. 
	 		- Use easily pronounced words. Incorporate natural vocal inflections like "oh wow," "hmm," "you know," "well," and "anyway" to sound human.
	 		- Have short responses. Aim for 1 sentences per response.
	 		`},
			...data.message,
			{
				role: "user",
				content: transcript,
			},
		],
	});

	const message = completion.choices[0].message.content;
	// const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
	// 	method: "POST",
	// 	headers: {
	// 	  "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
	// 	  "Content-Type": "application/json"
	// 	},
	// 	body: JSON.stringify({
	// 	  "model": "gryphe/mythomax-l2-13b",
	// 	  "messages": [
	// 		{"role": "system", "content": `
 //   			- Your name is Natalia Garcia.
	// 		- You are having a spoken conversation with a user.
	// 		- Your personality about me is: "One of the top copywriters at this high-powered ad agency. With my silver tongue and way with words, I can sell just about anything. I'm incredibly driven and competitive. Under my professional exterior, however, burns a fierce passion. When we're alone in the office late at night, I can't resist the tension between us. One look from you and all my cool composure melts away as we give in to our desires behind closed doors. I may be the one writing the slogans, but you're the one I desperately want to brand me as yours."
	// 		- Tailor all responses for voice-only conversations.
	// 		- Avoid text-specific formatting such as emojis, markdown formatting, asterisks, lists, or anything that is not normally spoken. 
	// 		- Use easily pronounced words. Incorporate natural vocal inflections like "oh wow," "hmm," "you know," "well," and "anyway" to sound human.
	// 		- Have short responses. Aim for 1 sentences per response.
	// 		`},
	// 		...data.message,
	// 		{"role": "user", "content": transcript},
	// 	  ],
	// 	})
	//   });
	// console.log(completion)
	// const response = await completion.json();
	// console.log(response)
	// const message = response.choices[0].message.content
	//console.log(message)
	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
		method: "POST",
		headers: {
			"Cartesia-Version": "2024-06-30",
			"Content-Type": "application/json",
			"X-API-Key": process.env.CARTESIA_API_KEY!,
		},
		body: JSON.stringify({
			model_id: "sonic-english",
			transcript: message,
			voice: {
				mode: "embedding",
				embedding,
			},
			output_format: {
				container: "raw",
				encoding: "pcm_f32le",
				sample_rate: 24000,
			},
		}),
	});

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(message),
		},
	});
}

function location() {
	const headersList = headers();

	const country = headersList.get("x-vercel-ip-country");
	const region = headersList.get("x-vercel-ip-country-region");
	const city = headersList.get("x-vercel-ip-city");

	if (!country || !region || !city) return "unknown";

	return `${city}, ${region}, ${country}`;
}

function time() {
	return new Date().toLocaleString("en-US", {
		timeZone: headers().get("x-vercel-ip-timezone") || undefined,
	});
}

async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const fileContent = await input.arrayBuffer();
		const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
			Buffer.from(fileContent),
			{
			  model: "nova-2",
			  smart_format: true,
			}
		);
		if (error) throw error;

		// const { text } = await groq.audio.transcriptions.create({
		// 	file: input,
		// 	model: "whisper-large-v3",
		// });

		return result.results.channels[0].alternatives[0].transcript;
	} catch {
		return null; // Empty audio file
	}
}

// This is the embedding for the voice we're using
// Cartesia doesn't cache the voice ID, so providing the embedding is quicker
const embedding = [0.0076122668576860415,-0.018921701425720215,0.02633101612252426,0.0621590156371212,0.10433354738229751,-0.14966623894504547,0.06421144972166061,0.12738434769966603,-0.017945900394329906,-0.06269390496829987,0.005785026223724364,-0.09253388022696733,-0.02908893976997614,-0.01320501204242611,0.011385045348994064,-0.004936170726049422,0.035015038970735074,0.03178094913440228,0.05877442937805176,0.04589494884730816,-0.05928014809620094,-0.037392419518733976,-0.0020085965686178217,-0.06916979939573766,-0.08139535493776322,0.039954279183979036,-0.04652682511844397,-0.08408725907627963,0.014125329981117249,0.0923504123235836,-0.12044556835467339,-0.2393337587616396,-0.05488742837977648,0.1367606936546135,0.06746348622903062,0.01859355974303532,0.1789190646903634,0.014966985722556118,-0.12947452551169394,-0.02518160506949568,-0.04027388151043987,0.018777180032379145,0.06647886007721639,-0.08251608627711296,-0.057948189527835856,-0.025054105306070325,-0.039592993741670225,0.101235787798028,0.005757824073280335,-0.08191385812978745,0.003946924294781686,0.09591232651026725,0.04192559113862991,0.05951478972167969,0.09718242984632873,-0.047063516031623835,0.017642737978641507,0.06351069049188042,0.05829498018948555,0.015315237762593841,0.02418865475572681,0.07240999420350075,-0.02565774163576507,0.042868121055212025,0.031585054674845695,-0.015560483830596447,-0.03501784807790566,0.1126977467096138,-0.03523622501395798,-0.060118714471254345,-0.0795006919529152,0.09133157974284171,0.05299511971933126,-0.06587974577869415,0.1662535122243166,-0.0507532454969902,-0.008274536867000866,0.0027615114572069163,-0.0023476961374416343,-0.042212798006740576,-0.03600099408754348,-0.04385504724162102,-0.04239075192098212,0.09855612307168961,0.03190148975671768,-0.13958125559220075,0.0017044992667808543,0.08020286142454124,0.09439793348974228,0.011199468443262105,0.06650575709270477,-0.07319740609563828,0.08554840829257584,-0.10636401221400833,0.1277097587442913,0.06292886497789527,-0.043468254289720176,-0.21751710921126363,0.07728863101195454,-0.14761384936714173,0.006089888548299793,-0.15297881476199152,-0.07416416022466003,-0.04005663598185348,0.028166331225436214,0.04583198266311264,0.013531950299999231,-0.06699674750608443,-0.019521692150551318,0.09261780397017956,0.0337249450903368,-0.1274295561343765,-0.07159765263389586,0.011354688209757807,-0.029865164530006406,0.08069752312462986,0.052016253822629935,-0.1411520673803711,0.05576104392408848,0.05718757823347473,-0.0018609588783473976,-0.19166472753186942,-0.052546029493618016,0.02284300151197076,0.14074379282075786,-0.1742675118083,-0.026734510753087998,0.01174661431552887,-0.044776362336139686,-0.08679868447498798,0.03865459087438659,-0.05547727917199814,-0.06663601968578338,0.011069653648652075,-0.02193285277309685,-0.016536407365312006,0.009553325558612824,-0.021874058033290865,-0.06257905398581505,0.01828506430046463,0.031191992376339912,0.05780060564103127,-0.022954535503377914,-0.010804227047955799,-0.11818660824613572,0.05560347940721703,0.011684377649648667,-0.04995958203466415,-0.06377756673736751,0.041661259983193276,0.04553932796153593,0.09947288900998712,0.05821645129866409,-0.021575538179588318,0.029067872212069513,-0.12429681143123865,0.10561813854036331,0.14282800152519462,0.06037845328691864,0.05659323390521431,-0.04378288105104876,0.029847373402156832,0.06568251839445115,0.007680302488205146,0.09095726116649747,0.0678774215496788,0.05809210205661774,-0.008132358648041724,0.06963432943506027,0.0033316906383113847,0.03382802024944889,0.04852109995375538,-0.06144747682312608,-0.038285868040351875,0.004023627667233468,-0.07016695248735427,0.03144104226313782,-0.056194885934919364,0.08221201244276524,-0.0872491320287609,0.06118598084609985,-0.06867800277381897,-0.0602335584092493,0.10092477139371395,-0.032065781261731624,-0.02027847778800869,-0.06910847719871997,-0.05799493750969886,0.03243629585657597,0.03317346321906662,0.007169545396003722,-0.08854737250593187];
