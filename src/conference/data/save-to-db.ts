import axios, { toFormData } from "axios";
import { createReadStream } from "fs";

export async function saveToDatabase(): Promise<void> {
    const file = createReadStream(__dirname + "./evaluate.csv");
    const body  = toFormData({
        file : file
    })

    const url = "http://localhost:3000/api/v1/admin-conference/import-evaluate";

    const data = await axios.post(url, body ,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    )
        .then((res) => {
            console.log("res", res.data);
        })
        .catch((err) => {
            console.log("err", err);
            return err;
        });
    console.log("data", data);
    return ;
}